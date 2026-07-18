# Adding Αγρότης to an existing Coolify FishBill deployment

The `agrotis-api` and `agrotis-admin-panel` are already wired into the
existing `docker-compose.yml`. You only need to add a handful of extra
environment variables in Coolify and redeploy.

## 1. Extra environment variables

Add these to the Coolify project's environment (**Environment Variables**
tab). The existing FishBill values stay untouched.

| Key | Example | Purpose |
| --- | --- | --- |
| `AGROTIS_JWT_SECRET` | `openssl rand -hex 32` — a NEW value, NOT the FishBill secret | JWT signing for agrotis-api |
| `AGROTIS_JWT_ACCESS_TTL` | `1d` (optional, default `1d`) | agrotis access-token lifetime |
| `AGROTIS_JWT_REFRESH_TTL` | `30d` (optional, default `30d`) | agrotis refresh-token lifetime |
| `AGROTIS_WRAPP_BASE_URL` | `https://staging.wrapp.ai/api/v1` (default) | Wrapp staging endpoint |
| `AGROTIS_WRAPP_PARTNER_API_KEY` | your Wrapp sandbox key | required — obtain from https://wrapp.ai/el/api/becomeapartner#contact |
| `AGROTIS_WRAPP_WEBHOOK_SECRET` | (optional) | HMAC secret for `/agrotis/api/webhooks/wrapp` |
| `AGROTIS_BOOTSTRAP_ADMIN_EMAIL` | `admin@agrotis.gr` (default) | super-admin email created on first migrate |
| `AGROTIS_BOOTSTRAP_ADMIN_PASSWORD` | required | initial super-admin password (change immediately after first login) |

MySQL, `DB_*` and `NODE_ENV` are reused from the existing FishBill setup.

## 2. Redeploy

Trigger a redeploy from Coolify. On startup you should see, in the
`agrotis-api` container logs:

```
[agrotis-entrypoint] Waiting for MySQL at db:3306...
[agrotis-entrypoint] MySQL is ready after 1 attempt(s)
▶ Running agrotis_001_initial.sql
✓ agrotis_001_initial.sql done
✓ Bootstrapped super-admin: admin@agrotis.gr / <password>
All migrations complete.
{"level":"info","message":"DB connection OK", ...}
{"level":"info","message":"Agrotis API listening on port 4001 (env=production)"}
{"level":"info","message":"Wrapp base URL: https://staging.wrapp.ai/api/v1"}
```

## 3. Verify

| URL | Expected |
| --- | --- |
| `https://master-app.gr/agrotis/api/health` | `{ "ok": true, "service": "agrotis-api", "wrapp": "configured", ... }` |
| `https://master-app.gr/agrotis/admin/`     | Green Αγρότης login page |
| `https://master-app.gr/api/health`         | FishBill health — unchanged |
| `https://master-app.gr/admin/`             | FishBill admin — unchanged |

## 4. First super-admin login

Open `https://master-app.gr/agrotis/admin/` and log in with the bootstrap
email + password. Change the password from the account menu immediately.

## What is shared, what is separated

| Shared | Separated |
| --- | --- |
| MySQL container (`db`) | Tables (`ag_*` vs FishBill's) |
| Nginx container (`web`) | HTTP routes (`/agrotis/*` vs `/*`) |
| Docker network | Node process (`agrotis-api:4001` vs `api:4000`) |
| Coolify project | JWT secrets |
| — | Wrapp partner API key (staging vs production) |
| — | Admin panels (own UI) |
| — | Legal pages (own copies) |
