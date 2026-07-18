// Αγρότης admin panel — talks ONLY to agrotis-api (not FishBill).
//
// Path-prefix deployment (default):
//   Admin panel lives at  https://master-app.gr/agrotis/admin/
//   API is routed at      https://master-app.gr/agrotis/api/*
//   Both served by the same nginx/Coolify reverse proxy — no extra DNS.
//
// Override at runtime by defining `window.__AGROTIS_API_URL__` before this
// script loads (useful for local dev pointing at http://localhost:4001).
window.CONFIG = {
  API_URL:      window.__AGROTIS_API_URL__ || '/agrotis/api',
  APP_NAME:     'Αγρότης',
  ADMIN_LABEL:  'Superadmin Αγρότη',
  VERSION:      '1.0.0',
};
