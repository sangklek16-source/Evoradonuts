window.APP_CONFIG = {
  APP_NAME: "DONAT BOSS",
  ENV: "production",
  API_BASE_URL: "",
  SUPABASE_URL: "https://ganti-dengan-project-ref.supabase.co",
  SUPABASE_ANON_KEY: "ganti-dengan-anon-key",
  SUPABASE_ASSET_BUCKET: "ganti_dengan_nama_bucket_kamu",
};

window.validateAppConfig = function validateAppConfig() {
  var cfg = window.APP_CONFIG || {};
  var missing = [];
  if (!cfg.SUPABASE_URL || String(cfg.SUPABASE_URL).indexOf("ganti-dengan") >= 0) missing.push("SUPABASE_URL");
  if (!cfg.SUPABASE_ANON_KEY || String(cfg.SUPABASE_ANON_KEY).indexOf("ganti-dengan") >= 0) missing.push("SUPABASE_ANON_KEY");
  if (!cfg.SUPABASE_ASSET_BUCKET || String(cfg.SUPABASE_ASSET_BUCKET).indexOf("ganti_dengan") >= 0) missing.push("SUPABASE_ASSET_BUCKET");
  return {
    ok: missing.length === 0,
    missing: missing,
  };
};
