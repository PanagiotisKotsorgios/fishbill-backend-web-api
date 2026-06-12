# FishBill API — Developer Documentation

> Backend of **FishBill** — invoicing, delivery notes (ΔΑ), weighing slips and myDATA/ΥΠΑΗΕΣ
> transmission platform for Greek professional fishermen.
>
> Repo: `fishbill-backend-web-api` · Runtime: **Node.js / Express** · DB: **MySQL (mysql2/promise)**
> Companion documents: [`WRAPP-INTEGRATION.md`](WRAPP-INTEGRATION.md) ·
> [`WRAPP-API-COMPLIANCE-AUDIT.md`](WRAPP-API-COMPLIANCE-AUDIT.md)

---

## Table of contents

1. [High-level architecture](#1-high-level-architecture)
2. [Boot sequence](#2-boot-sequence)
3. [Project layout](#3-project-layout)
4. [HTTP pipeline (app.js)](#4-http-pipeline-appjs)
5. [Authentication, authorization & subscription gating](#5-authentication-authorization--subscription-gating)
6. [Route catalog](#6-route-catalog)
7. [Services](#7-services)
8. [Background jobs (cron)](#8-background-jobs-cron)
9. [Database & startup migrations](#9-database--startup-migrations)
10. [Document lifecycle: invoices & delivery notes](#10-document-lifecycle-invoices--delivery-notes)
11. [PDF strategy](#11-pdf-strategy)
12. [Email system](#12-email-system)
13. [Push notifications (FCM)](#13-push-notifications-fcm)
14. [Logging & observability](#14-logging--observability)
15. [Security](#15-security)
16. [Configuration & environment](#16-configuration--environment)
17. [Deployment](#17-deployment)
18. [Verification & test tooling](#18-verification--test-tooling)

---

## 1. High-level architecture

```
┌─────────────────┐        HTTPS (Retrofit/OkHttp)        ┌──────────────────────────┐
│  Android app    │ ─────────────────────────────────────▶│  FishBill API (Express)  │
│  (Kotlin/       │ ◀───────────────────────────────────  │  master-app.gr           │
│   Compose)      │        JSON + JWT Bearer              │  behind Traefik/Coolify  │
└─────────────────┘                                       └────────────┬─────────────┘
                                                                       │
        ┌──────────────────────────────┬───────────────────────────────┼──────────────────┐
        ▼                              ▼                               ▼                  ▼
┌───────────────┐            ┌──────────────────┐            ┌────────────────┐   ┌────────────┐
│ MySQL          │            │ Wrapp ΥΠΑΗΕΣ     │            │ e-Timologiera  │   │ AADE       │
│ fishbill_db    │            │ (primary myDATA  │            │ V4 (legacy     │   │ myDATA     │
│                │            │  provider)       │            │  provider)     │   │ (direct,   │
└───────────────┘            └──────────────────┘            └────────────────┘   │  DN XML)   │
                                       ▲                                          └────────────┘
                                       │ webhooks (api_key, MARK, PDF URL,
                                       │           cancellation MARK)
                                       └── POST /api/wrapp/webhook
```

Key design decisions:

- **Provider abstraction at transmit time** — `invoice.service.transmit()` routes each document to
  **Wrapp** when `businesses.wrapp_enabled = 1`, otherwise to **e-Timologiera**. A third client
  (`aade-mydata.service.js`) talks to AADE myDATA directly (XML) and is used for delivery notes in
  non-Wrapp setups.
- **Wrapp owns the legal PDF.** After a Wrapp transmission we *never* render our own PDF — the
  AADE-stamped PDF arrives via webhook (`wrapp_pdf_url`). See [§11](#11-pdf-strategy).
- **Auto-transmit cron** — every 60 s any `draft/issued/failed` invoice or delivery note of a
  Wrapp-enabled business is picked up and transmitted (so users never press a "transmit" button).
- **Startup migrations** — additive `ALTER TABLE` statements run on every boot
  (`server.js → runMigrations()`); no external migration tool in the hot path.
- **All user-facing error strings are Greek**; logs are English.

---

## 2. Boot sequence

`src/server.js`:

1. `dotenv` loads `.env`.
2. `validateEnv()` (`src/utils/validateEnv.js`) **hard-fails** when `JWT_SECRET`,
   `JWT_REFRESH_SECRET` or `ENCRYPTION_KEY` are missing, shorter than 32 chars, or still set to a
   known placeholder. Weak `DB_PASSWORD` fails in production, warns in dev.
3. `app.js` is required (builds the whole Express pipeline).
4. `app.listen(PORT /* default 4000 */, '0.0.0.0')` and then, inside the listen callback:
   - `runMigrations()` — additive column migrations + data corrections (see [§9](#9-database--startup-migrations)).
   - `startEmailCampaigns(pool)` — daily email crons.
   - `startAutoTransmit()` — 60-second Wrapp auto-transmit cron.
5. Process-level handlers: `unhandledRejection` → graceful close + exit 1; `SIGTERM`/`SIGINT` →
   drain pool, force-kill after 10 s.

---

## 3. Project layout

```
src/
├── server.js                 # entrypoint, migrations, cron startup, shutdown handling
├── app.js                    # Express app: webhook, security, CORS, rate limits, route mounting
├── config/
│   ├── database.js           # mysql2/promise pool (utf8mb4, tz +02:00, limit 10)
│   └── encryption.js         # AES (crypto-js) encrypt/decrypt for stored credentials
├── middleware/
│   ├── auth.js               # authenticate (JWT) + requireActiveSubscription (HTTP 402)
│   ├── role.js               # requireRole / requireSuperAdmin / requireOwnerOrAbove
│   ├── audit.js              # logAudit(action, entityType) → audit_logs (post-response)
│   └── validate.js           # Joi schema validation middleware (422 with field details)
├── routes/                   # 30 route modules — see §6
├── services/
│   ├── wrapp.service.js      # Wrapp Partners API v2.1 + Invoice API v1.13.0 (see WRAPP-INTEGRATION.md)
│   ├── invoice.service.js    # numbering, totals, transmit() provider router
│   ├── etimologiera.service.js # e-Timologiera V4 client (legacy provider)
│   ├── mydata.service.js     # AADE myDATA direct REST (platform credentials, XML)
│   ├── aade-mydata.service.js  # AADE myDATA direct for DNs (per-business credentials, XML)
│   ├── pdf.service.js        # PDFKit fallback renderer (invoice + DN) — non-Wrapp only
│   ├── email.service.js      # SMTP-relay (HTTP) email sender + all templates
│   └── export.service.js     # CSV exports (invoices, customers, products)
├── jobs/
│   ├── autoTransmit.js       # */1m: transmit pending invoices + DNs for Wrapp businesses
│   ├── emailCampaigns.js     # daily 07:00/08:00/08:15/08:30 trial & subscription emails
│   └── pushNotifications.js  # FCM helper (firebase-admin, service account from DB)
└── utils/
    ├── calculateTotals.js    # line → net/vat/discount/total math (2-dec rounding)
    ├── logger.js             # winston (dev: pretty console, prod: JSON + rotating files)
    └── validateEnv.js        # boot-time secret validation
scripts/
└── verify-wrapp-compliance.js # 83-assertion self-test of Wrapp payload helpers (see §18)
```

---

## 4. HTTP pipeline (app.js)

Order matters — this is the exact middleware order:

| # | Layer | Notes |
|---|-------|-------|
| 1 | `trust proxy = 1` | Behind Traefik/Coolify; required for rate-limit + correct `req.ip`. |
| 2 | **Wrapp webhook** `GET/POST /api/wrapp/webhook` | Registered **before** CORS & rate-limiting so Wrapp's unknown Origin can never be rejected. Self-contained body parsers. See `WRAPP-INTEGRATION.md §7`. |
| 3 | `helmet` | HSTS (1y, preload), CSP, `noSniff`, `frameguard: deny`, hide `X-Powered-By`. |
| 4 | CORS | Allow-list from `CORS_ORIGINS` env (comma-separated). Requests with **no Origin** (mobile app, curl, server-to-server) always pass. |
| 5 | `morgan` | `combined` in prod, `dev` otherwise → winston stream. |
| 6 | Body parsing | JSON limit **10 MB** (base64 avatar/PDF uploads). |
| 7 | Rate limits | General `/api/*`: 1000 / 15 min. Login + admin-login: 30 / 60 min. Sensitive auth (forgot/reset password, owner recovery, OTP): 5 / 10 min. Refresh: 60 / 15 min. |
| 8 | Static mounts | `/avatars`, `/uploads`, `/apk` (APK content-type + attachment headers, no auth so Android `DownloadManager` works), `/uploads/invoices`, `/uploads/delivery-notes`, `/pdfs` (7-day cache). |
| 9 | Public endpoints | `GET /api/public/stats` (landing page counters), `GET /api/public/config`, `GET /api/status` (maintenance flag), `GET /health` (DB ping + uptime). |
| 10 | **Route mounting** | See below. |
| 11 | 404 handler | JSON `{error}`. |
| 12 | Global error handler | Greek messages; maps MySQL codes: `ER_DUP_ENTRY`→409, `ER_NO_REFERENCED_ROW_2`→400, `ER_ROW_IS_REFERENCED_2`→400, `ER_BAD_FIELD_ERROR`→500 ("missing column"), other `ER_*`→503. |

**Route mounting** (`gate = [authenticate, requireActiveSubscription]`):

```js
// Subscription-gated business features (402 'subscription_inactive' when expired)
/api/dashboard /api/customers /api/products /api/invoices /api/stats /api/exports
/api/search /api/iris /api/integrations /api/employees /api/delivery-notes
/api/weighing-slips /api/ospa /api/configure /api/mydata          → gate + router

// Free (authenticate inside each router where needed)
/api/auth /api/businesses /api/users /api/logs /api/notifications /api/backups
/api/settings /api/subscription /api/accountant /api/platform /api/monitor
/api/afm /api/employee-actions
/api/admin/otp  → authenticate + router
```

---

## 5. Authentication, authorization & subscription gating

- **JWT Bearer** (`middleware/auth.js`): verifies `JWT_SECRET`, loads
  `users (id, business_id, role, is_active)`, rejects inactive accounts (403). Distinguishes
  `TokenExpiredError` (401 "Token expired…") so the app's `TokenAuthenticator` knows to refresh.
- **last_seen_at throttle**: at most one `UPDATE users SET last_seen_at` per user per 60 s
  (in-memory map) — powers the admin "online users" panel.
- **Refresh tokens**: `POST /api/auth/refresh` issues a new access token from
  `JWT_REFRESH_SECRET`-signed refresh token.
- **Roles**: `super_admin`, `owner`, `employee`, `accountant`, `monitor` (association).
  `requireRole(...)` / `requireSuperAdmin` / `requireOwnerOrAbove` in `middleware/role.js`.
- **Subscription gate**: `requireActiveSubscription` returns **HTTP 402**
  `{error:'subscription_inactive'}` when `businesses.subscription_active != 1`. Only applies to
  `owner`/`employee` roles. The Android app intercepts 402 globally and routes to the
  subscription-gate screen.
- **Audit**: `logAudit(action, entity)` middleware appends to `audit_logs` *after* the response is
  flushed (`res.on('finish')` + `setImmediate`), never blocking or failing the request.

---

## 6. Route catalog

All paths below are relative to their mount point. **G** = behind the subscription gate.

### 6.1 `auth.routes.js` → `/api/auth`

| Method & path | Purpose |
|---|---|
| `POST /login` | Email+password login → access + refresh JWT. Maintenance-mode aware. |
| `GET /verify-email/:token` | Email verification link landing. |
| `POST /resend-verify` | Resend verification email. |
| `POST /register` | Business + owner registration (creates `businesses`, `users`, settings rows; sends welcome + admin notification emails). |
| `POST /refresh` | Refresh-token → new access token. |
| `POST /logout` | Invalidate refresh token. |
| `POST /change-password` | Authenticated password change. |
| `DELETE /me` · `POST /delete-request` | Account deletion (immediate / request-based). |
| `POST /forgot-password` · `POST /reset-password` | Reset flow (emailed token). |
| `POST /owner-recovery` · `POST /owner-recovery-login` | Owner account recovery via OTP. |
| `POST /admin-login` | Super-admin login (separate limiter). |

### 6.2 `invoices.routes.js` → `/api/invoices` (G) — 1 612 lines, the core module

| Method & path | Purpose |
|---|---|
| `GET /stats` | Aggregate counts/sums for the business. |
| `GET /` | Paginated list (filters: status, type, date range, search). |
| `POST /` *(inside file)* | Create invoice: find-or-create customer by `customer_name`/AFM, lock-free numbering via `invoice.service.getNextNumber` (SELECT…FOR UPDATE), totals via `calculateTotals`, then **status `issued`** → picked up by auto-transmit. Credit invoices: `creditInvoiceType` is always **`'1.5'`** (Πιστωτικό μη συσχετιζόμενο) with negative amounts stored internally; label "Πιστωτικό τιμολόγιο". |
| `GET /:id` | Detail incl. lines + customer + transmission state. |
| `DELETE /:id` | Delete draft. |
| `GET /:id/pdf` | **PDF resolution order** (see §11): wrapp-enabled → only Wrapp PDF (proxied `wrapp_pdf_url`, else trigger `generate_pdf`, else 202/409); legacy → `pdf_path` from disk. Auto-cleans stale `pdf_path` rows when Wrapp is on. |
| `GET /:id/xml` | myDATA XML preview (legacy providers). |
| `GET /:id/logs` | `transmission_logs` for this invoice. |

### 6.3 `delivery-notes.routes.js` → `/api/delivery-notes` (G)

| Method & path | Purpose |
|---|---|
| `GET /` | Paginated list. |
| `POST /` | Create DN. **Idempotency:** accepts `client_ref` (stamped by the app *before* its first network call); a retry with the same `client_ref` returns the existing row instead of creating a duplicate. Status `issued` → auto-transmit. |
| `GET /:id` | Detail incl. lines. |
| `PATCH /:id/cancel` | Wrapp path: `wrapp.cancelDeliveryNote()` → stores `cancellation_mark` or sets `cancellation_pending=1` (webhook delivers the MARK later), NULLs `wrapp_pdf_url`, status `cancelled`. Direct-AADE path: type 1.6 cancellation XML. |
| `POST /:id/transmit` | Manual transmit trigger (same code path as auto-transmit). |
| `GET /:id/pdf` | Same strict Wrapp-first PDF logic as invoices. |
| `POST /request-extra-credits` · `GET /extra-credits` | Monthly DN quota top-up requests (admin grants via platform routes). |

### 6.4 `customers.routes.js` → `/api/customers` (G)

`GET /lookup-afm` (GSIS ΑΑΔΕ registry lookup, cached), `GET /recent`, `GET /search`, `GET /`,
`GET /:id`, `GET /:id/invoices`, plus create/update handlers. Customers are
**find-or-create by name/AFM** from the invoice flow — the app never manages customer IDs directly.

### 6.5 `products.routes.js` → `/api/products` (G)

`GET /favorites`, `GET /` (list, fish species catalog), `GET /:id`.

### 6.6 `weighing-slips.routes.js` → `/api/weighing-slips` (G)

`GET /fish-types/list` (34 FAO species), `POST /sync` (**offline batch sync** — the app's Room DB
uploads queued slips; per-item success/fail with `local_id` echo), `GET /`, `POST /`, `GET /:id`,
`PATCH /:id`, `DELETE /:id`. Slip photos land in `/uploads` (multer).

### 6.7 `ospa.routes.js` → `/api/ospa` (G)

ΟΣΠΑ (fish auction levy) records: monthly summary, CRUD.

### 6.8 `stats.routes.js` → `/api/stats` (G) · `dashboard.routes.js` → `/api/dashboard` (G)

Dashboard aggregates: overview, invoices-by-day, top customers/products, revenue, monthly,
summary; chart endpoints feed the Android home screen.

### 6.9 `settings.routes.js` → `/api/settings`

Per-business settings hub used by the app's Ρυθμίσεις screen:

| Endpoint | Purpose |
|---|---|
| `GET /` · `PATCH /profile` | Business profile (name, AFM, address, phone, ΔΟΥ…). |
| `GET /gsis/status` · `PATCH /gsis` | GSIS (ΑΑΔΕ AFM lookup) credentials. |
| `PATCH /mydata` | Per-business AADE myDATA credentials (user id + subscription key). |
| `PATCH /email` · `PATCH /sms` · `PATCH /notifications` · `PATCH /invoice` · `PATCH /appearance` | Notification / invoice-numbering / theme prefs. |
| `GET /etimologiera/status` · `PATCH /etimologiera` · `GET /mydata/status` | Provider status checks. |
| `GET /features` | Feature flags (`feature_ospa`, `feature_weighing_slips`, …). |
| `GET /wrapp/status` | App-facing Wrapp state: enabled? api_key present? → drives "Πάροχος ΑΑΔΕ" section. |
| `POST /wrapp/initiate-onboarding` | **User-facing** onboarding: calls `wrapp.initiateOnboarding(bizId)` → returns Wrapp `login_url` the app opens in the browser. |
| `GET /wrapp/test` | Connectivity self-test. |

### 6.10 `subscription.routes.js` → `/api/subscription`

`GET /status` (active/grace/expired + ends_at), `POST /request`, `POST /cancel`,
`PATCH /autorenew`, `GET /pricing`, `GET /package-details`, `POST /notify-renewal`.
Subscription activation itself happens **via the Wrapp webhook** (12 months + 1 bonus month on
first subscription) or manually via platform routes.

### 6.11 `platform.routes.js` → `/api/platform` — super-admin panel (2 338 lines)

Functional groups:

- **Status/config**: `GET /status`, `GET /public-settings`, `GET /app-config` (minimum app
  version → Android update dialog), `GET /wrapp-ping`, `GET/POST/PATCH /settings`,
  `PATCH/GET /settings/firebase`, `PATCH/GET /settings/gsis`, `GET/PUT /payment-settings`.
- **Subscriptions**: list, `POST /subscriptions/:bizId/activate` (months, price), `extend-trial`,
  `mark-parametrised`, `deactivate`, `record-payment`, `set-price`, `contact-phone`,
  `GET /outstanding` (unpaid balances), `GET /economics` (MRR/expenses), `GET/POST/DELETE /expenses`.
- **CRM**: `GET/POST /calls*` (call log per business), `GET /reminders/upcoming`,
  `GET/POST/DELETE /reminders/sms*`.
- **Email center**: `GET /email/users`, `POST /email/send-direct`, `POST /email/campaign`,
  `GET /email/stats`, `PATCH /email/toggles`, `POST /email/stats/reset`.
- **Invoice ops**: `POST /invoices/:id/upload-pdf` (manual PDF attach, base64),
  `GET /invoices/:id/pdf-blob`, `users-summary`, `pending-mark`, `transmitted`,
  `PATCH /invoices/:id/mark` (manual MARK entry), `GET /businesses/:id/invoices`.
- **Delivery-note ops**: users-summary / pending / transmitted / cancelled lists,
  `PATCH /:id/mark`, `POST /:id/transmit`, `PATCH /:id/cancel`, `POST /:id/upload-pdf`,
  `GET /:id/pdf`.
- **DN credits**: `GET /dn-credit-requests`, grant/reject, `POST /businesses/:bizId/grant-dn-credits`.
- **Wrapp admin** (see `WRAPP-INTEGRATION.md §8`): `GET/PUT /wrapp/settings` (partner key, base
  URL, webhook endpoint), `GET /wrapp/status/:bizId`, `POST /wrapp/initiate-onboarding/:bizId`,
  `PATCH /wrapp/toggle/:bizId`, `GET/POST /wrapp/credentials/:bizId`,
  `DELETE /wrapp/clear-billing-cache/:bizId`, `GET /wrapp/logs` (tail wrapp.log),
  `POST /wrapp/logs/clear`, `POST /wrapp/transmit-pending` (manual auto-transmit tick).
- **Misc**: `GET /online-users` (last_seen_at within window), `PATCH /businesses/:bizId/email`,
  `POST /dev-setup` / `POST /dev-cleanup` (test fixtures).

### 6.12 Other route modules (summary)

| Module | Mount | Highlights |
|---|---|---|
| `users.routes.js` | `/api/users` | List, `PATCH /me/avatar` (base64 → `/public/avatars`), `PATCH /:id/verify`, `PATCH/DELETE /me/fcm-token` (FCM registration). |
| `businesses.routes.js` | `/api/businesses` | Business CRUD-ish reads, `GET /:id/features`, payments sub-resource, delete-request. |
| `accountant.routes.js` | `/api/accountant` | Separate accountant portal: register/verify, manage client businesses (profile, GSIS, myDATA, series, products, customers, invoices read). |
| `employee.routes.js` | `/api/employees` (G) | Employee accounts, privileges, association assignment, impersonation. |
| `employee-actions.routes.js` | `/api/employee-actions` | Scoped admin-employee operations on delivery notes (summary/pending/transmit/cancel/upload-pdf). |
| `monitor.routes.js` | `/api/monitor` | Fishing-association ("ΟΣΠΑ monitor") read-only portal + SMS reminders. |
| `configure.routes.js` | `/api/configure` (G) | Associations CRUD, per-business myDATA/GSIS/profile/status admin edits. |
| `iris.routes.js` | `/api/iris` (G) | IRIS instant-payments: per-business settings, platform config, payment requests log. |
| `integrations.routes.js` | `/api/integrations` (G) | Test email/SMS/provider, `POST /provider/transmit`, `POST /retry-failed`, webhooks CRUD, logs. |
| `mydata.routes.js` | `/api/mydata` (G) | Direct AADE config/test, DN XML preview, manual transmit invoice/DN. |
| `afm.routes.js` | `/api/afm` | `GET /lookup` (GSIS authenticated), `GET /public-lookup` (registration autofill). |
| `notifications.routes.js` | `/api/notifications` | In-app notification feed, read/read-all, admin broadcast. |
| `logs.routes.js` | `/api/logs` | Audit + transmission logs, purge. |
| `backups.routes.js` | `/api/backups` | DB backup create/list/download/restore (super-admin). |
| `exports.routes.js` | `/api/exports` (G) | CSV: invoices, customers, audit log, transmission log, products (fast-csv stream). |
| `search.routes.js` | `/api/search` (G) | Global search across invoices/customers/DNs. |
| `admin-otp.routes.js` | `/api/admin/otp` | OTP request/verify for sensitive admin actions. |

---

## 7. Services

### 7.1 `invoice.service.js` — provider router

- `getNextNumber(businessId, series)` — transactional `SELECT … FOR UPDATE` on `invoice_series`;
  auto-creates a series row; returns `{number, fullNumber: 'A-000123'}`.
- `calculateAndSaveInvoice(id)` — recompute totals from `invoice_lines`.
- **`transmit(invoice)`** — the central dispatch:
  1. Self-heals legacy `invoice_type='1.3'` rows → `'1.5'` (DB + in-memory) — 1.3 is *non-EU
     sales* in myDATA, not credit.
  2. Loads lines, business, customer (by `customer_id`, fallback to denormalised
     `customer_name`/`customer_afm` columns).
  3. `wrapp_enabled === 1` → `wrapp.transmitInvoice(...)`; on success: status `transmitted`,
     stores MARK + QR + `wrapp_invoice_id`, **NULLs `pdf_path`/`wrapp_pdf_url`** and unlinks any
     stale disk PDF; logs to `transmission_logs (provider='wrapp')`. *No local PDF is rendered.*
  4. Otherwise → `buildEtimPayload(...)` → `etimologiera.sendInvoice()`; on MARK: status
     `transmitted` + `autoGeneratePDF()` (fire-and-forget PDFKit render to
     `/uploads/invoices/{id}.pdf`).
  5. Any error → status `failed`, `last_error`, failure row in `transmission_logs`.
- `buildEtimPayload()` — full V4 e-Timologiera JSON (type map incl. 9.3 ΔΑ, VAT analysis,
  income classification `E3_561_001` / `category1_1`, counterpart, `extra` PDF block).

### 7.2 `wrapp.service.js` — Wrapp integration (1 036 lines)

Fully documented in [`WRAPP-INTEGRATION.md`](WRAPP-INTEGRATION.md). Exported surface:

```js
{ transmitDeliveryNote, transmitInvoice, cancelDeliveryNote,
  initiateOnboarding, checkUserStatus, invalidateCache, generatePdf }
```

### 7.3 `etimologiera.service.js` — legacy provider (BRATNET e-Timologiera V4)

Basic-auth JSON client. Credentials per business (`businesses.etimologiera_username/_api_key`)
with platform-level fallback (`platform_settings.provider_*`); `provider_test_mode='1'` switches
dev/prod base URL. `sendInvoice`, `cancelInvoice (DELETE /cancelSignature/:uid)`,
`testConnection` (a 400/422 on empty payload counts as "connected"; 401 = bad credentials).

### 7.4 `mydata.service.js` + `aade-mydata.service.js` — direct AADE myDATA

Two direct XML clients (`SendInvoices` / `CancelInvoice`):

- `mydata.service.js`: platform-level credentials (`platform_settings.mydata_*`), FishBill acts as
  the ERP; fisherman's AFM in `issuer.vatNumber`.
- `aade-mydata.service.js`: **per-business** credentials (`businesses.mydata_user_id`,
  `mydata_subscription_key`), used for delivery notes; Greek transport-purpose label →
  AADE `movePurpose` int map; `parseMark()` extracts MARK from the response XML;
  `cancelDeliveryNote(mark, afm)` posts to `CancelInvoice?mark=`.

Headers on every AADE call: `aade-user-id` + `Ocp-Apim-Subscription-Key`.

### 7.5 `pdf.service.js`

PDFKit A4 renderer with embedded Greek-capable font resolution. `generateInvoicePDF(invoice)` and
`generateDeliveryNotePDF(note)` write to `pdfs/`. **Used only on the e-Timologiera/legacy path** —
Wrapp documents must use the Wrapp PDF (legal requirement).

### 7.6 `email.service.js`

HTTP relay (axios POST to configured mail endpoint; settings in `platform_settings`). Includes
per-type platform toggles (`isPlatformEmailEnabled`) and send counters (`trackEmailSent`).
Template inventory: password reset (web + mobile deep link), welcome, accountant verification
(request → admin / result → accountant), admin notifications (new business, new accountant,
verification action), invoice lifecycle (created / transmitted / failed), DN created + admin-DN
ready, **invoice/DN cancelled admin alerts**, daily summary, direct/campaign sends, admin OTP.

### 7.7 `export.service.js`

`fast-csv` streaming CSV exports (invoices with filters, customers, products), super-admin can
export across businesses.

---

## 8. Background jobs (cron)

| Job | Schedule | What it does |
|---|---|---|
| `autoTransmit.js` | every 60 s (`* * * * *`) + once at boot | For every business with `wrapp_enabled=1` AND an api_key: transmit up to 20 pending invoices (`draft/issued/failed`) via `invoice.service.transmit` and up to 20 pending DNs via `wrapp.transmitDeliveryNote`. Failures → status `failed` + `mydata_response` error JSON; the next tick retries. All output tagged `[AUTO_TX]` in `logs/wrapp.log`. |
| `emailCampaigns.js` | `0 8 * * *` trial expiring · `15 8 * * *` trial expired · `30 8 * * *` subscription expiring · `0 7 * * *` subscription expired | Greek HTML emails to owners (7/3/1-day warnings, expiry notices). Deduped per business per day. |
| `pushNotifications.js` | (helper, not scheduled) | `sendPushNotification(pool, userId, …)` / `sendPushToAllUsers`. Lazy-inits firebase-admin from the `firebase_service_account` JSON stored in `platform_settings`. Stale token errors auto-clear `users.fcm_token`. Channel id: `fishbill_main`. |

---

## 9. Database & startup migrations

MySQL pool: `utf8mb4`, timezone `+02:00`, connection limit 10, keep-alive. Failure to connect at
boot does **not** exit — `/health` reports degraded instead.

### Core tables (referenced throughout the code)

`users`, `businesses`, `business_settings`, `customers`, `products`, `invoices`,
`invoice_lines`, `invoice_series`, `delivery_notes`, `delivery_note_lines`, `weighing_slips`,
`ospa_records`, `transmission_logs`, `audit_logs`, `notifications`, `platform_settings`
(key/value), `subscription/payment/call/sms` admin tables, `accountants`, `associations`.

### Wrapp-related columns (added by startup migrations in `server.js`)

| Table | Column | Purpose |
|---|---|---|
| `businesses` | `wrapp_api_key`, `wrapp_user_id`, `wrapp_enabled` | Per-business Wrapp credentials (webhook-delivered). |
| `businesses` | `wrapp_partner_user_id` | Partner-side UUID (we send our business id). |
| `businesses` | `wrapp_billing_book_inv_id`, `wrapp_billing_book_dn_id` | Cached billing-book ids (1.1 / 9.3). Reversal books are never cached. |
| `invoices` | `wrapp_invoice_id`, `wrapp_qr_url`, `wrapp_pdf_url`, `pdf_path` | Wrapp doc id, myDATA QR, legal PDF URL, legacy disk PDF. |
| `delivery_notes` | `wrapp_invoice_id`, `wrapp_mark`, `wrapp_qr_url`, `wrapp_pdf_url` | Same for DNs. |
| `delivery_notes` | `cancellation_mark`, `cancellation_pending` | Cancellation MARK (sync or webhook-delivered). |
| `delivery_notes` | `dispatch_time`, `mydata_mark`, `mydata_uid`, `mydata_response`, `transmitted_at`, `pdf_path` | DN transmission state. |

### Data-correction migrations (idempotent, every boot)

- `price_pro` 15 → 12 in `platform_settings`.
- **`invoice_type '1.3' → '1.5'`** for rows in `draft/failed/issued` — the historical
  credit-invoice code mistake (1.3 = non-EU sales in myDATA). The same correction is enforced at
  runtime in `invoice.service.transmit()` (DB self-heal) and `wrapp.service.transmitInvoice()`
  (wire remap), so the fix holds even for rows created by an old app build.

---

## 10. Document lifecycle: invoices & delivery notes

```
 Android app                FishBill API                          Wrapp / AADE
 ───────────                ────────────                          ────────────
 POST /api/invoices ──────▶ create rows, status='issued'
 (or /delivery-notes        (DN: client_ref idempotency)
  with client_ref)
                            ⏱ autoTransmit (≤60 s later)
                            invoice.service.transmit()
                              └─ wrapp.transmitInvoice ─────────▶ POST /api/v1/invoices
                                                                  ◀ 201 {id, my_data_mark?, status:'pending'?}
                            status='transmitted', save MARK/QR/wrapp_invoice_id
                            pdf_path=NULL, wrapp_pdf_url=NULL
                                                                  (async) myDATA resolves
                            ◀──────────────────────────────────── webhook: issued-invoice {id, my_data_mark}
                            update MARK / status (idempotent)
                            ◀──────────────────────────────────── webhook: invoice-pdf {invoice_id, download_url}
                            save wrapp_pdf_url
 GET /api/invoices/:id/pdf ▶ proxy wrapp_pdf_url (or trigger generate_pdf → 202)
```

Status machine (both tables): `draft → issued → transmitted | failed (→ retried) → cancelled`
(DNs only; invoices are reversed with a 1.5 credit instead — there is **no invoice cancel**, by
design, since myDATA requires a reversal document).

Key invariants:

- **Idempotent DN creation** via `client_ref` (the app stamps `dn_local_{ts}_{rand}` before its
  first network attempt; offline queue preserves it).
- **Reversal documents (1.4/1.5/5.1/5.2)** are stored with negative amounts internally but
  transmitted with `Math.abs()` values + `correlated_invoices: [originalMark]`.
- **DN cancellation** produces no new PDF — it is a myDATA-level state change. The detail screen
  shows the `cancellation_mark` (or "Αναμονή επιβεβαίωσης από myDATA…" while
  `cancellation_pending=1`).

---

## 11. PDF strategy

**Rule: if `wrapp_enabled=1`, the only legally valid PDF is Wrapp's.** Enforced in three layers:

1. `invoice.service.transmit()` skips `autoGeneratePDF` on the Wrapp path and NULLs `pdf_path`
   (+ unlinks the disk file).
2. `GET /:id/pdf` (invoices + DNs) resolves `wrapp_enabled` **first**; when set it ignores
   `pdf_path` entirely, auto-cleans stale rows (NULL + unlink), and serves:
   - `wrapp_pdf_url` present → stream/redirect it;
   - else → `wrapp.generatePdf(wrappInvoiceId)` → `download_url` (sync) or **202** "PDF queued"
     (the webhook will deliver it; the app retries);
   - no `wrapp_invoice_id` yet → **409** with a Greek explanation (not yet transmitted).
3. The Android `PdfDownloadHelper` busts caches with `updated_at` in the filename and
   `forceRefresh=true` on the detail screens.

Legacy (e-Timologiera / direct AADE) businesses keep the PDFKit-rendered file at
`/uploads/invoices/{id}.pdf` (`pdf_path`).

---

## 12. Email system

- Transport: HTTP relay configured in `platform_settings` (`SETTING_KEYS` in
  `email.service.js`); `APP_BASE_URL` drives web links, mobile deep links for password reset.
- Per-type kill switches + counters editable from the admin panel
  (`PATCH /api/platform/email/toggles`, `GET /email/stats`).
- Campaign engine: `POST /api/platform/email/campaign` + the four daily crons (§8).
- All templates share `baseTemplate()` (branded, Greek).

## 13. Push notifications (FCM)

- App registers its token via `PATCH /api/users/me/fcm-token` (cleared on logout via `DELETE`).
- Server sends through firebase-admin (service-account JSON pasted in admin panel → DB).
- Notifications use Android channel `fishbill_main`, `priority: high`; invalid-token responses
  clear the stored token automatically.

## 14. Logging & observability

| Log | Source | Notes |
|---|---|---|
| `logs/wrapp.log` | `wrapp.service` (`[HTTP-OUT]/[HTTP-IN]` + per-function tags), `app.js` webhook (`[WEBHOOK]`), `invoice.service` (`[INVOICE_TX]`), `autoTransmit` (`[AUTO_TX]`) | Every outgoing Wrapp request/response (secrets truncated to 8-char prefixes, bodies capped at 2 000 chars). Tail it from the admin panel: `GET /api/platform/wrapp/logs`. |
| `logs/error.log`, `logs/combined.log` | winston (prod only, rotating 10/20 MB) | JSON lines. |
| Console | morgan + winston | Captured by Coolify. |
| `audit_logs` table | `logAudit` middleware | Method, path, status, user, business, IP. |
| `transmission_logs` table | invoice transmissions | provider, success, MARK or error per attempt. |

## 15. Security

- Helmet: HSTS preload, CSP, frameguard deny, noSniff.
- Joi `validate()` middleware (strip unknown, 422 with per-field details).
- Parameterised SQL exclusively (`pool.execute`).
- bcrypt password hashing; JWT access + separate refresh secret.
- AES (crypto-js) for stored third-party credentials (`config/encryption.js`,
  `ENCRYPTION_KEY` ≥ 32 chars enforced at boot).
- Layered rate limits (§4) and OTP for sensitive admin actions.
- Webhook endpoint always answers 200 on business-level failures (logged) so Wrapp doesn't retry
  forever, but 500s on genuine internal errors.

## 16. Configuration & environment

`.env` (see `.env.example`):

| Variable | Purpose |
|---|---|
| `PORT` | Default 4000. |
| `DB_HOST/PORT/USER/PASSWORD/NAME` | MySQL. |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` | ≥ 32 chars, validated at boot. |
| `CORS_ORIGINS` | Comma-separated browser origins (mobile traffic has no Origin). |
| `APP_BASE_URL` | Public base URL for email links. |
| `NODE_ENV`, `LOG_LEVEL`, `ADMIN_EMAIL` | Behaviour switches. |
| `ETIMOLOGIERA_DEV_URL`, `ETIMOLOGIERA_PROD_URL` | Optional overrides. |

Runtime-editable configuration lives in **`platform_settings`** (key/value): Wrapp partner key /
base URL / webhook endpoint, myDATA platform credentials, GSIS credentials, Firebase service
account, email/SMS relay settings, prices, maintenance mode, minimum app version, IRIS platform
settings, feature toggles.

## 17. Deployment

- **Dockerfile** + `entrypoint.sh`; deployed on **Coolify** (Traefik reverse proxy → `trust
  proxy`). Static asset dirs (`uploads/`, `pdfs/`, `public/`, `logs/`) must be persistent volumes.
- Production host: `https://master-app.gr` (the Android app's `BASE_URL`).
- Wrapp staging gate uses basic-auth embedded in `wrapp_base_url`
  (`https://user:pass@staging.wrapp.ai`) — `wrapp.service` extracts it into axios `auth`
  automatically.
- Deploy = push to GitHub → Coolify redeploy. Startup migrations make schema changes hands-free.

## 18. Verification & test tooling

- **`scripts/verify-wrapp-compliance.js`** — standalone runner (`node
  scripts/verify-wrapp-compliance.js`) that extracts the payload helpers from
  `wrapp.service.js` source and executes **83 assertions**: `safeText`, `safePostal`,
  `parseStreetNumber`, `stripStreetNumber`, `unitCode`, `movementPurposeCode`,
  `formatDispatchDate`, `athensParts`, full delivery-detail payload shape, counterpart shape and
  webhook field resolution. Run it after touching any payload-building code.
- **`WRAPP-API-COMPLIANCE-AUDIT.md`** — clause-by-clause audit of our usage against Wrapp API
  v1.13.0 (score 100/100, with the fix log in §9 of that file).
- `set-admin-password.js`, `run-migration-020.js`, `/api/platform/dev-setup` — operational
  helpers.

---

*Generated June 2026. Keep this file in sync when adding routes, services, or schema migrations.*
