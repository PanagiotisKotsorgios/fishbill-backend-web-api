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

All routes are exposed at the server root. Behind a reverse proxy the
recommended layout uses a path prefix on the existing `master-app.gr`
domain — no new subdomain or DNS record needed:

```
https://master-app.gr/agrotis/api/*   → agrotis-api  (this service)
https://master-app.gr/agrotis/admin/  → agrotis-admin-panel (static)
https://master-app.gr/api/*           → fishbill-api  (unchanged)
https://master-app.gr/admin/          → fishbill admin (unchanged)
```

The Express app itself is prefix-agnostic — nginx/Coolify strips
`/agrotis/api` before forwarding, so internally routes stay clean
(`/health`, `/auth/login`, …).

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

## Deployment (Coolify — path prefix, no new DNS)

```bash
docker build -t agrotis-api .
docker run --rm -p 4001:4001 --env-file .env agrotis-api
```

Add the container to Coolify alongside the existing `fishbill-api`
service and route it via a path prefix on the same domain — no new DNS,
no extra SSL cert:

**nginx snippet** (Coolify custom directive or standalone):
```nginx
# Existing FishBill routes stay untouched — nothing to change.

# Αγρότης API — strip the /agrotis/api prefix before forwarding.
location /agrotis/api/ {
    proxy_pass         http://agrotis-api:4001/;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    client_max_body_size 10M;
}

# Αγρότης admin panel — static files.
location /agrotis/admin/ {
    alias /srv/agrotis-admin-panel/;
    index index.html;
    try_files $uri $uri/ /agrotis/admin/index.html;
}
```

The trailing slash on `proxy_pass http://agrotis-api:4001/` is what
makes nginx strip the `/agrotis/api` prefix before forwarding. Express
then sees requests like `/health`, `/auth/login` — no code change
needed inside the app.

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
