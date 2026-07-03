// supabaseClient.js
// Inisialisasi Supabase client dari config yang sudah diisi di config.js
// File ini harus di-load SETELAH config.js dan SEBELUM app.bundle.js

(function () {
  var cfg = window.APP_CONFIG || {};
  var url = cfg.SUPABASE_URL;
  var key = cfg.SUPABASE_ANON_KEY;
  var configCheck = typeof window.validateAppConfig === "function" ? window.validateAppConfig() : { ok: !!url && !!key, missing: [] };

  function showBootError(message) {
    window.__APP_BOOT_ERROR = message;
    try {
      var root = document.getElementById("app") || document.body;
      if (!root) return;
      var wrap = document.createElement("div");
      wrap.style.fontFamily = "system-ui, sans-serif";
      wrap.style.margin = "16px";
      wrap.style.padding = "16px";
      wrap.style.borderRadius = "12px";
      wrap.style.border = "1px solid rgba(239,68,68,0.25)";
      wrap.style.background = "rgba(239,68,68,0.08)";
      wrap.style.color = "#b91c1c";
      wrap.innerHTML =
        "<strong>Konfigurasi aplikasi belum siap</strong><br>" +
        message.replace(/\n/g, "<br>");
      root.prepend(wrap);
    } catch (_) {}
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    window.sb = null;
    showBootError("Library Supabase belum termuat. Pastikan script Supabase di-load sebelum supabaseClient.js.");
    return;
  }

  if (!configCheck.ok) {
    window.sb = null;
    showBootError("Buka config.js lalu isi: " + (configCheck.missing || []).join(", "));
    return;
  }

  try {
    var client = window.supabase.createClient(url, key, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
      global: {
        headers: {
          "x-application-name": cfg.APP_NAME || "DONAT BOSS",
        },
      },
    });

    window.sb = client;
    window.__APP_BOOT_ERROR = "";
    window.sbSafe = {
      getSession: function () { return client.auth.getSession(); },
      signOut: function () { return client.auth.signOut(); },
    };
  } catch (err) {
    window.sb = null;
    showBootError("Gagal membuat client Supabase: " + (err && err.message ? err.message : String(err)));
  }
})();
