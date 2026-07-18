# Αγρότης API

Completely separate backend environment for the Αγρότης Android app.
**Does not share code, routes, tables, or configuration with `fishbill-api/`.**

## Highlights

- Runs on its own port (default **4001**)
- Own MySQL database (or same MySQL server with `ag_*` prefixed tables)
- Own JWT secret
- Uses **Wrapp staging** partner API (sandbox), never production
- Own admin authentication + `ag_admins` table
- Own admin dashboard at `agrotis-admin-panel/`

## Environment

Copy `.env.example` → `.env` and fill in:

```
PORT=4001
DB_HOST=…
DB_USER=agrotis
DB_PASSWORD=…
DB_NAME=agrotis
JWT_SECRET=<long random string, NOT the FishBill secret>
WRAPP_BASE_URL=https://staging.wrapp.ai/api/v1
WRAPP_PARTNER_API_KEY=<your sandbox key from https://wrapp.ai/el/api/becomeapartner#contact>
```

## Install & run

```bash
cd agrotis-api
npm install
npm run migrate     # creates all ag_* tables and bootstraps a super-admin
npm start           # or `npm run dev` for hot-reload
```

## API routes

All routes rooted at the server URL (e.g. `https://agrotis-api.master-app.gr/`
or `https://master-app.gr/agrotis-api/` behind a reverse proxy).

| Path | Purpose |
| --- | --- |
| `GET /health` | liveness + which Wrapp env is configured |
| `POST /auth/register` | agrotis user + business signup |
| `POST /auth/login` | user login → access + refresh tokens |
| `POST /auth/refresh` | rotate tokens |
| `GET  /auth/me` | current user profile |
| `GET  /invoices` | list current business' invoices |
| `POST /invoices` | issue new invoice via Wrapp staging |
| `GET  /invoices/:id` | invoice details + lines |
| `GET  /delivery-notes` | list current business' delivery notes |
| `POST /delivery-notes` | issue new delivery note via Wrapp staging |
| `POST /delivery-notes/:id/cancel` | cancel via Wrapp DELETE /invoices/:id/cancel |
| `GET  /dashboard` | user dashboard summary counters |
| `GET  /subscription/plan` | Αγρότης Pro plan info |
| `GET  /subscription/status` | current business' subscription state |
| `POST /webhooks/wrapp` | Wrapp webhook receiver (HMAC-SHA256 verified) |
| `POST /admin/login` | super-admin login |
| `GET  /admin/stats` | platform-wide counters |
| `GET  /admin/users` | list all users |
| `GET  /admin/businesses` | list all businesses |
| `GET  /admin/invoices` | list all invoices |
| `PATCH /admin/subscriptions/:business_id` | manage a business' subscription |

## Deployment (Coolify or plain Docker)

```bash
docker build -t agrotis-api .
docker run --rm -p 4001:4001 --env-file .env agrotis-api
```

Behind nginx/Coolify, route either a subdomain
(e.g. `agrotis-api.master-app.gr`) or a path prefix (`/agrotis-api/*`) to
this container. FishBill (`fishbill-api/`) stays on its own port and route.

## What is NOT shared with FishBill

- Tables (`ag_*` prefix)
- JWT secret
- Wrapp partner API key (this one is the sandbox / staging)
- Node process (separate port)
- Admin panel (see `agrotis-admin-panel/`)
- Email templates
- Dockerfile / deployment

## Security notes

- Bootstrap super-admin credentials (`BOOTSTRAP_ADMIN_EMAIL` /
  `BOOTSTRAP_ADMIN_PASSWORD`) are ONLY consumed on first migration when
  `ag_admins` is empty. Change the password immediately after first login.
- The Wrapp base URL is validated at boot; a warning is logged if it doesn't
  look like a staging URL. The intent is to never accidentally hit production
  from this codebase.
