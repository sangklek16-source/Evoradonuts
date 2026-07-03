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
  const sanitizeText = (value, max = 200) => String(value || "").trim().slice(0, max);

  const fetchSingle = async (path) => {
    const resp = await fetch(buildRestUrl(path), { headers: serviceHeaders });
    const json = await getJsonOrText(resp);
    if (!resp.ok) throw new Error(json?.message || json?.error || json?.msg || `Gagal mengambil data: ${path}`);
    return Array.isArray(json) ? (json[0] || null) : json;
  };

  const patchProfileWithFallback = async (userId, patches) => {
    let lastError = null;
    for (const payload of patches) {
      const resp = await fetch(`${buildRestUrl("profiles")}?user_id=eq.${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: {
          ...serviceHeaders,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(payload),
      });
      if (resp.ok) return true;
      lastError = await getJsonOrText(resp);
    }
    throw new Error(lastError?.message || lastError?.error || lastError?.msg || "Gagal mengarsipkan profil.");
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

  try {
    if (!SUPABASE_URL || !ANON || !SERVICE) {
      return res.status(500).json({ error: "Env di Vercel belum lengkap (SUPABASE_URL/ANON/SERVICE)." });
    }

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    if (!token) return res.status(401).json({ error: "Butuh Authorization Bearer token (owner harus login)." });

    const body = parseBody(req.body);
    const target_user_id = sanitizeText(body?.target_user_id, 120);
    const target_email = sanitizeText(body?.target_email, 160) || null;
    const reason = sanitizeText(body?.reason, 300);

    if (!target_user_id) return res.status(400).json({ error: "target_user_id wajib." });
    if (!reason) return res.status(400).json({ error: "Alasan penonaktifan wajib diisi." });

    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    });
    const userJson = await getJsonOrText(userResp);
    if (!userResp.ok) {
      return res.status(401).json({ error: userJson?.msg || userJson?.error || "Token owner tidak valid." });
    }
    const ownerId = userJson?.id;
    if (!ownerId) return res.status(401).json({ error: "Tidak bisa membaca owner id." });
    if (ownerId === target_user_id) {
      return res.status(403).json({ error: "Owner tidak boleh menonaktifkan akunnya sendiri dari aplikasi." });
    }

    const ownerProfile = await fetchSingle(`profiles?select=user_id,role,status,deleted_at&user_id=eq.${ownerId}&limit=1`);
    if (ownerProfile?.role !== "owner") {
      return res.status(403).json({ error: "Hanya owner yang boleh menonaktifkan akun." });
    }

    const targetProfile = await fetchSingle(`profiles?select=user_id,role,email,display_name,branchId,investorId,gajiHarian,status,deleted_at&user_id=eq.${target_user_id}&limit=1`);
    if (!targetProfile?.role) return res.status(404).json({ error: "Target user tidak ditemukan di profiles." });
    if (targetProfile.role === "owner") return res.status(403).json({ error: "Akun owner tidak boleh dihapus dari aplikasi." });

    const finalEmail = target_email || targetProfile.email || null;
    const deletedAt = new Date().toISOString();
    const archivedEmailBase = String(finalEmail || target_user_id || "deleted-user").replace(/[^a-zA-Z0-9._-]/g, "-");
    const archivedEmail = `deleted-${Date.now()}-${archivedEmailBase}@arsip.local`;
    const archivedDisplayName = targetProfile.display_name ? `${targetProfile.display_name} (Arsip)` : "Akun Arsip";

    const profilePatches = [
      {
        role: "none",
        status: "deleted",
        deleted_at: deletedAt,
        deleted_by: ownerId,
        delete_reason: reason,
        email: archivedEmail,
        display_name: archivedDisplayName,
        branchId: null,
        investorId: null,
        gajiHarian: 0,
      },
      {
        role: "none",
        deleted_at: deletedAt,
        email: archivedEmail,
        display_name: archivedDisplayName,
        branchId: null,
        investorId: null,
        gajiHarian: 0,
      },
      {
        role: "none",
        email: archivedEmail,
        display_name: archivedDisplayName,
        branchId: null,
        investorId: null,
        gajiHarian: 0,
      },
    ];

    await patchProfileWithFallback(target_user_id, profilePatches);

    const warnings = [];

    if (finalEmail) {
      const inviteDeleteResp = await fetch(`${buildRestUrl("invites")}?email=eq.${encodeURIComponent(finalEmail)}`, {
        method: "DELETE",
        headers: serviceHeaders,
      }).catch((err) => ({ ok: false, _localError: err }));
      if (!inviteDeleteResp.ok) warnings.push("Riwayat invite lama tidak ikut dibersihkan.");
    }

    const delResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${target_user_id}`, {
      method: "DELETE",
      headers: serviceHeaders,
    }).catch((err) => ({ ok: false, _localError: err }));

    if (!delResp.ok) {
      const delErr = delResp._localError || await getJsonOrText(delResp);
      warnings.push(`Akun auth tidak terhapus penuh, tetapi profil sudah diarsipkan: ${delErr?.message || delErr?.msg || delErr?.error || "unknown error"}`);
    }

    await logAudit({
      action: "archive_user",
      entity_type: "profile",
      entity_id: target_user_id,
      actor_id: ownerId,
      notes: `Menonaktifkan akun ${finalEmail || target_user_id}`,
      payload: {
        reason,
        archivedEmail,
        originalEmail: finalEmail,
        originalRole: targetProfile.role,
      },
    });

    return res.json({
      ok: true,
      userId: target_user_id,
      deletedProfile: {
        email: targetProfile.email,
        role: targetProfile.role,
        display_name: targetProfile.display_name || null,
        branchId: targetProfile.branchId || null,
        investorId: targetProfile.investorId || null,
        deleted_at: deletedAt,
        reason,
      },
      warnings,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
};
