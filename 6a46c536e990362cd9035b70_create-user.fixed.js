module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const ANON = process.env.SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const parseBody = (rawBody) => {
    if (typeof rawBody !== "string") return rawBody || {};
    try { return JSON.parse(rawBody); }
    catch { throw new Error("Body request tidak valid."); }
  };

  const getJsonOrText = async (resp) => {
    const text = await resp.text();
    if (!text) return null;
    try { return JSON.parse(text); }
    catch { return text; }
  };

  const serviceHeaders = {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
  };

  const buildRestUrl = (path) => `${SUPABASE_URL}/rest/v1/${path}`;
  const sanitizeText = (value, max = 120) => String(value || "").trim().slice(0, max);
  const normalizeEmailOrUsername = (value) => {
    const raw = sanitizeText(value, 160).toLowerCase();
    if (!raw) return "";
    return raw.includes("@") ? raw : `${raw}@donatboss.local`;
  };

  const logAudit = async (payload) => {
    try {
      await fetch(buildRestUrl("audit_logs"), {
        method: "POST",
        headers: {
          ...serviceHeaders,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(payload),
      });
    } catch (_) {}
  };

  const fetchSingle = async (path) => {
    const resp = await fetch(buildRestUrl(path), { headers: serviceHeaders });
    const json = await getJsonOrText(resp);
    if (!resp.ok) throw new Error(json?.message || json?.error || json?.msg || `Gagal mengambil data: ${path}`);
    return Array.isArray(json) ? (json[0] || null) : json;
  };

  try {
    if (!SUPABASE_URL || !ANON || !SERVICE) {
      return res.status(500).json({ error: "Env di Vercel belum lengkap (SUPABASE_URL/ANON/SERVICE)." });
    }

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    if (!token) return res.status(401).json({ error: "Butuh Authorization Bearer token." });

    const body = parseBody(req.body);
    const email = normalizeEmailOrUsername(body.emailOrUsername);
    const password = String(body.password || "").trim();
    const role = sanitizeText(body.role, 30);
    const displayName = sanitizeText(body.displayName, 80) || null;
    const branchId = sanitizeText(body.branchId, 80) || null;
    const investorId = sanitizeText(body.investorId, 80) || null;
    const gajiHarian = role === "worker" && body.gajiHarian !== null && body.gajiHarian !== ""
      ? Math.max(0, Number(body.gajiHarian) || 0)
      : null;

    if (!email) return res.status(400).json({ error: "Username / email wajib diisi." });
    if (/\s/.test(email)) return res.status(400).json({ error: "Username / email tidak boleh mengandung spasi." });
    if (!password || password.length < 8) return res.status(400).json({ error: "Password minimal 8 karakter." });
    if (!["worker", "investor", "owner"].includes(role)) {
      return res.status(400).json({ error: "Role harus worker / investor / owner." });
    }

    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    });
    const userData = await getJsonOrText(userResp);
    if (!userResp.ok) {
      return res.status(401).json({ error: userData?.msg || userData?.error || "Token tidak valid." });
    }
    const ownerId = userData?.id;
    if (!ownerId) return res.status(401).json({ error: "Tidak bisa membaca owner id." });

    const ownerProfile = await fetchSingle(`profiles?select=user_id,role,display_name,email,status,deleted_at&user_id=eq.${ownerId}&limit=1`);
    if (ownerProfile?.role !== "owner") {
      return res.status(403).json({ error: "Hanya owner yang boleh membuat akun." });
    }
    if (ownerProfile?.status === "deleted" || ownerProfile?.deleted_at) {
      return res.status(403).json({ error: "Akun owner ini sudah tidak aktif." });
    }

    if (role === "worker") {
      if (!branchId) return res.status(400).json({ error: "Pilih cabang untuk worker." });
      const branch = await fetchSingle(`branches?select=id,name&id=eq.${encodeURIComponent(branchId)}&limit=1`);
      if (!branch?.id) return res.status(400).json({ error: "Cabang yang dipilih tidak ditemukan." });
    }

    if (role === "investor") {
      if (!investorId) return res.status(400).json({ error: "Pilih investor untuk akun investor." });
      const investor = await fetchSingle(`investors?select=id,nama&id=eq.${encodeURIComponent(investorId)}&limit=1`);
      if (!investor?.id) return res.status(400).json({ error: "Investor yang dipilih tidak ditemukan." });
    }

    const existingProfile = await fetchSingle(`profiles?select=user_id,email,role,status,deleted_at&email=eq.${encodeURIComponent(email)}&limit=1`).catch(() => null);
    if (existingProfile && existingProfile.user_id && existingProfile.role !== "none" && existingProfile.status !== "deleted" && !existingProfile.deleted_at) {
      return res.status(409).json({ error: "Email / username ini sudah dipakai akun lain." });
    }

    const displayLabel = displayName || email.split("@")[0];
    const createResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        ...serviceHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { role, display_name: displayLabel },
        app_metadata: { role },
      }),
    });
    const createJson = await getJsonOrText(createResp);
    if (!createResp.ok) {
      return res.status(400).json({ error: createJson?.msg || createJson?.error || createJson || "Gagal membuat user." });
    }

    const newUserId = createJson?.id || createJson?.user?.id;
    if (!newUserId) return res.status(400).json({ error: "User dibuat tapi id tidak ditemukan." });

    const profilePayload = {
      user_id: newUserId,
      email,
      role,
      display_name: displayLabel,
      branchId: role === "worker" ? branchId : null,
      investorId: role === "investor" ? investorId : null,
      gajiHarian: role === "worker" ? gajiHarian : null,
    };

    const profInsertResp = await fetch(buildRestUrl("profiles"), {
      method: "POST",
      headers: {
        ...serviceHeaders,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(profilePayload),
    });

    if (!profInsertResp.ok) {
      const profileErr = await getJsonOrText(profInsertResp);
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${newUserId}`, {
        method: "DELETE",
        headers: serviceHeaders,
      }).catch(() => {});

      return res.status(400).json({
        error: profileErr?.message || profileErr?.msg || profileErr?.error || profileErr || "Gagal membuat profil. User auth dibatalkan kembali.",
      });
    }

    await fetch(buildRestUrl("invites"), {
      method: "POST",
      headers: {
        ...serviceHeaders,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        email,
        role,
        displayName,
        branchId: role === "worker" ? branchId : null,
        investorId: role === "investor" ? investorId : null,
        created_by: ownerId,
      }),
    }).catch(() => {});

    await logAudit({
      action: "create_user",
      entity_type: "profile",
      entity_id: newUserId,
      actor_id: ownerId,
      notes: `Membuat akun ${role} untuk ${email}`,
      payload: {
        email,
        role,
        branchId: role === "worker" ? branchId : null,
        investorId: role === "investor" ? investorId : null,
      },
    });

    return res.json({
      ok: true,
      email,
      userId: newUserId,
      profile: profilePayload,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
};
