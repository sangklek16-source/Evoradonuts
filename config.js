window.APP_CONFIG = {
  APP_NAME: "DONAT BOSS",
  ENV: "production",
  API_BASE_URL: "",
  SUPABASE_URL: "https://nariuxjcbqweveyybbnv.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5hcml1eGpjYnF3ZXZleXliYm52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNDEzNjYsImV4cCI6MjA5ODYxNzM2Nn0.Mo75imlE258r9D-PMdne__LgylWrbiba9W4x2_28hpU",
  SUPABASE_ASSET_BUCKET: "donat-assets",
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
