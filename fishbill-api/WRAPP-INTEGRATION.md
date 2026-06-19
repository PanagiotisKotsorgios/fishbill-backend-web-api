# FishBill ⇄ Wrapp Integration — Complete Technical Reference

> **Scope:** This document describes **every single interaction** between the FishBill backend
> and the **Wrapp Invoice API v1.13.0** / **Wrapp Partners API v2.1** — endpoint by endpoint,
> payload field by payload field, including all helper functions, caching layers, webhook
> branches, error handling, and the production pitfalls we solved along the way.
>
> Companion documents:
> - [`DEVELOPER-DOCUMENTATION.md`](./DEVELOPER-DOCUMENTATION.md) — full backend architecture
> - [`WRAPP-API-COMPLIANCE-AUDIT.md`](./WRAPP-API-COMPLIANCE-AUDIT.md) — 100/100 compliance audit sheet
> - [`scripts/verify-wrapp-compliance.js`](./scripts/verify-wrapp-compliance.js) — 83 automated assertions

---

## Table of Contents

1. [Why Wrapp](#1-why-wrapp)
2. [Architecture Overview](#2-architecture-overview)
3. [Configuration & Environments](#3-configuration--environments)
4. [Partner Onboarding Flow](#4-partner-onboarding-flow)
5. [Authentication — Login & JWT Cache](#5-authentication--login--jwt-cache)
6. [Billing Books](#6-billing-books)
7. [Invoice Transmission (1.1 / 1.5 / 5.x)](#7-invoice-transmission)
8. [Delivery Note Transmission (9.3)](#8-delivery-note-transmission-93)
9. [Delivery Note Cancellation](#9-delivery-note-cancellation)
10. [Official PDFs](#10-official-pdfs)
11. [Webhook Reference — All 4 Branches](#11-webhook-reference)
12. [Subscription Status Check](#12-subscription-status-check)
13. [Auto-Transmit Cron](#13-auto-transmit-cron)
14. [Helper Function Reference](#14-helper-function-reference)
15. [Database Schema (Wrapp Columns)](#15-database-schema-wrapp-columns)
16. [Logging & Diagnostics](#16-logging--diagnostics)
17. [Known Pitfalls & How We Solved Them](#17-known-pitfalls--how-we-solved-them)
18. [Compliance Verification](#18-compliance-verification)

---

## 1. Why Wrapp

Wrapp is a licensed Greek **ΥΠΑΗΕΣ provider** (Πάροχος Υπηρεσιών Ηλεκτρονικής Έκδοσης
Στοιχείων). For legal reasons, **all official documents (PDFs) must be issued by the
licensed provider, not by FishBill**:

- Wrapp transmits every document to **AADE myDATA** and returns the official **MARK**
  (Μοναδικός Αριθμός Καταχώρησης), **UID**, and **QR URL**.
- Wrapp generates the **official PDF** with the provider's signature block and QR code.
- FishBill keeps its own numbering, customers, lines and totals in MySQL — but the
  *legal* artefacts (MARK, PDF) always come from Wrapp.

FishBill talks to two Wrapp APIs:

| API | Auth | Used for |
|---|---|---|
| **Partners API v2.1** | `X-PARTNER-API-KEY` header (platform-level key) | Onboarding (`external_login`), subscription check (`embedded_check_user`) |
| **Invoice API v1.13.0** | `Bearer <JWT>` (per-business, from `/login`) | Billing books, invoice/DN transmission, cancellation, PDF generation |

All integration code lives in **`src/services/wrapp.service.js`** (single module,
~1 030 lines). The inbound webhook lives in **`src/app.js`** (registered *before* all
other middleware). The background transmitter lives in **`src/jobs/autoTransmit.js`**.

---

## 2. Architecture Overview

```
┌─────────────┐   POST /external_login    ┌──────────────┐
│  FishBill    │ ─────────────────────────▶│              │
│  backend     │   (X-PARTNER-API-KEY)     │              │
│              │ ◀───────────────────────  │    Wrapp     │
│  Node.js     │   login_url               │  staging /   │
│  Express     │                           │  production  │
│  MySQL       │   POST /login (api_key)   │              │
│              │ ─────────────────────────▶│   ↕ myDATA   │
│              │ ◀─ JWT (cached 23 h) ──── │    (AADE)    │
│              │                           │              │
│              │   POST /invoices          │              │
│              │ ─────────────────────────▶│              │
│              │ ◀─ id / MARK / QR ─────── │              │
│              │                           │              │
│              │ ◀─ POST /api/wrapp/webhook│              │
│              │   (api_key, MARK, PDF,    │              │
│              │    cancelled_by_mark)     │              │
└─────────────┘                           └──────────────┘
```

Document flow for a Wrapp-enabled business:

1. User creates an invoice/DN in the Android app → stored in MySQL (`status='issued'` or `'draft'`).
2. Transmit is triggered (manually via `/transmit` endpoint, or by the **auto-transmit cron** every 60 s).
3. `wrapp.service.js` logs in (JWT cache), resolves the billing book, builds the payload, `POST /api/v1/invoices`.
4. Wrapp responds with `id` (+ MARK/UID/QR immediately, **or** `status:"pending"` if myDATA is slow).
5. If pending, the MARK arrives later via **webhook**.
6. The official PDF is fetched lazily via `GET /generate_pdf` (or delivered via webhook when queued).

---

## 3. Configuration & Environments

All Wrapp configuration is stored in the **`platform_settings`** DB table (editable from
the admin panel) — **no Wrapp values live in `.env`**:

| `setting_key` | Meaning |
|---|---|
| `wrapp_partner_api_key` | Platform-level Partners API key (`X-PARTNER-API-KEY` header) |
| `wrapp_base_url` | Wrapp base URL. Staging: `https://user:pass@staging.wrapp.ai` (see below). Production: `https://wrapp.ai` |
| `wrapp_webhook_endpoint` | Public URL Wrapp POSTs to: `https://master-app.gr/api/wrapp/webhook` |

`getSettings()` (wrapp.service.js) loads these three keys on **every call** (no cache) so
admin changes take effect immediately. Default fallback for `baseUrl` is `https://wrapp.ai`
with trailing slash stripped.

### 3.1 Production vs staging base URL

**Production (live since 2026-06-19)**

```
https://wrapp.ai
```

No basic-auth gate, no embedded credentials. The Partner API key (`X-PARTNER-API-KEY`)
is the only secret needed.

**Staging (historical, for reference)**

Wrapp's staging environment was behind an HTTP basic-auth gate. The credentials were
embedded in the base URL:

```
https://wrappadmin:****@staging.wrapp.ai
```

Both `getJwt()` and `initiateOnboarding()` parse the URL with `new URL(...)`; if
`urlObj.username` is present they:

1. Move the credentials into axios `auth: { username, password }` (with `decodeURIComponent`),
2. Blank `urlObj.username/password` so the credentials never appear in the request URL or logs.

When the base URL has no embedded credentials (production), the basic-auth branch is
simply skipped — same code path works for both environments.

**Switching staging → production is a single DB value change** (the base URL plus the
Partner API key), with zero code changes:

```sql
UPDATE platform_settings SET setting_value = 'https://wrapp.ai'
  WHERE setting_key = 'wrapp_base_url';
UPDATE platform_settings SET setting_value = '<production partner api key>'
  WHERE setting_key = 'wrapp_partner_api_key';
```

---

## 4. Partner Onboarding Flow

Onboarding connects a FishBill business to a Wrapp account. It uses the **Partners API**
and is exposed to users via `POST /api/settings/wrapp/initiate-onboarding`
(`src/routes/settings.routes.js:533`) and to admins via the platform routes.

### 4.1 `POST /api/v1/external_login`

`initiateOnboarding(businessId)` — `src/services/wrapp.service.js:873`

**Preconditions (hard errors, Greek messages):**
- `wrapp_partner_api_key` must be set in platform_settings.
- `wrapp_webhook_endpoint` must be set.
- The business must have an **email** (`COALESCE(business.email, owner_user.email)` — falls
  back to the owner's login email if the business profile has none).
- The business must have a **phone** (required by Wrapp; the user is told to fill it in
  Ρυθμίσεις → Προφίλ Επιχείρησης).

**Phone normalisation** (Wrapp expects a bare Greek mobile, no country code):

```js
let phone = biz.phone.trim().replace(/[\s\-().+]/g, '');   // strip spaces, dashes, parens, '+'
if (phone.startsWith('0030'))                       phone = phone.slice(4);
else if (phone.startsWith('30') && phone.length === 12) phone = phone.slice(2);
```

**Request:**

```http
POST {baseUrl}/api/v1/external_login
X-PARTNER-API-KEY: <wrapp_partner_api_key>
Content-Type: application/json

{
  "email":            "<business or owner email>",
  "partner_user_id":  "<businessId as string>",      ← our stable reference, echoed back in webhooks
  "webhook_endpoint": "https://master-app.gr/api/wrapp/webhook",
  "phone":            "69XXXXXXXX"
}
```

**Response:** `{ "login_url": "https://…" }` — we return this URL to the Android app,
which opens it in the browser so the fisherman completes Wrapp's own sign-up/contract flow.

**Error handling:** if Wrapp returns HTML (staging gate misconfigured / proxy error) we
detect `d.trim().startsWith('<')` and show a friendly Greek "server not responding" message
instead of dumping HTML at the user. Otherwise we surface
`message || error || errors[0].message` with the HTTP status.

### 4.2 Credential delivery (webhook)

When the fisherman finishes Wrapp sign-up, **Wrapp POSTs our webhook** with the business's
personal `api_key` (+ `wrapp_user_id`). See [§11.4](#114-onboarding-branch) — we store the
credentials, set `wrapp_enabled = 1`, invalidate the JWT cache, and **auto-activate the
FishBill subscription (12 + 1 months) the first time**.

---

## 5. Authentication — Login & JWT Cache

### 5.1 `POST /api/v1/login`

`getJwt(businessId)` — `src/services/wrapp.service.js:169`

Each business authenticates with its **own** `wrapp_api_key` (delivered via the onboarding
webhook) plus its **email**:

```http
POST {baseUrl}/api/v1/login
Content-Type: application/json
Accept: application/json

{ "api_key": "<business wrapp_api_key>", "email": "<business email>" }
```

> Wrapp's login accepts `email` **or** `wrapp_user_id`; we send email because it is simpler
> and always available (same `COALESCE` fallback to owner email as onboarding).

**Response:** JWT extracted from `resp.data.data.attributes.jwt` (JSON:API envelope).
Missing JWT → hard error «Αποτυχία σύνδεσης Wrapp: δεν επεστράφη JWT.»

### 5.2 JWT cache

```js
const jwtCache = {};   // { [businessId]: { jwt, expiresAt } }
jwtCache[businessId] = { jwt, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
```

- In-memory, **per business**, valid **23 hours** (Wrapp JWTs last 24 h — 1 h safety margin).
- Cache HIT/EXPIRED/MISS each produce a distinct log line (`[getJwt]` tag) with remaining minutes.
- `invalidateCache(businessId)` clears the entry — called from the **onboarding webhook**
  whenever a (new) `api_key` is saved, so a re-onboarded business never reuses a JWT issued
  against the old key.
- Being in-memory, the cache resets on every deploy/restart — first transmit after a deploy
  re-logs-in. This is intentional (no stale tokens persisted anywhere).

### 5.3 Credential loading & guards

`getBusinessCredentials(businessId)` loads from `businesses` (joined with the owner user
for the email fallback) and enforces:

| Check | Greek error |
|---|---|
| Business exists | «Επιχείρηση δεν βρέθηκε.» |
| `wrapp_enabled = 1` | «Το Wrapp δεν είναι ενεργοποιημένο για αυτή την επιχείρηση.» |
| `wrapp_api_key` present | «Δεν βρέθηκε Wrapp API key. Ολοκληρώστε πρώτα την εγγραφή στο Wrapp.» |

---

## 6. Billing Books

Every Wrapp invoice must reference a **billing book** (`billing_book_id`) whose
`invoice_type_code` is compatible with the document being issued. Resolution is a
three-layer system: **DB cache → GET list → auto-create**.

### 6.1 Names & series maps

`createBillingBook()` — `src/services/wrapp.service.js:215`

```js
const NAMES = {
  '9.3': 'Deltia Apostolis',        // delivery notes
  '1.1': 'Timologia Polisis',       // sales invoices
  '1.3': 'Pistotika Polisis 13',    // (legacy — see §17.3)
  '1.5': 'Pistotika Polisis 15',    // non-correlated credit invoices
  '2.1': 'Timologia Parochis',      // service invoices
  '2.4': 'Pistotika Parochis 24',
  '5.1': 'Pistotika Correlated',    // correlated credit
  '5.2': 'Pistotika NonCorrelated',
};
const SERIES = { '1.1':'A', '1.3':'C', '1.5':'E', '2.1':'P', '2.4':'Q', '5.1':'R', '5.2':'S', '9.3':'D' };
```

Rules learned from Wrapp staging (verified by live tests):

- `series` **must be Latin** letters (Greek letters are rejected).
- The create payload requires **`number: 1`** (not `start_number`).
- Wrapp rejects **duplicate name *or* series** across books of the same tenant → every
  type gets a **distinct series letter**.

**Create request:**

```http
POST {baseUrl}/api/v1/billing_books
Authorization: Bearer <jwt>

{ "name": "Timologia Polisis", "series": "A", "invoice_type_code": "1.1", "number": 1 }
```

### 6.2 The 422 "already in use" reuse path

If creation returns **422** with `errors[].title` matching
`/ήδη χρησιμοποιήσει|already.*taken|already.*used/i`, a book with that name/series already
exists (possibly stored under a *different* type code after Wrapp normalisation — see
§17.3). We then `GET /api/v1/billing_books`, find the existing book by
`name === name || series === series`, and **reuse its id** instead of failing.

### 6.3 Lookup with universalisation awareness

`fetchBillingBookId()` — `src/services/wrapp.service.js:286`

```http
GET {baseUrl}/api/v1/billing_books
Authorization: Bearer <jwt>
```

Matching order:

1. **Exact** `invoice_type_code` match → use it.
2. **Prefix fallback** (`1.x` book covers `1.*` per Wrapp's *universalisation* rule) —
   **but only for non-reversal types**. Reversal types (`1.3`, `1.5`, `5.1`, `5.2`)
   **never** use the prefix fallback because Wrapp staging rejects «Invoice Type does not
   match selected Billing Book Invoice Type» for them.
3. Nothing found → **auto-create** via `createBillingBook()`.

### 6.4 Caching strategy

`getBillingBookId(businessId, invoiceTypeCode)` — `src/services/wrapp.service.js:331`

| Type | Cache behaviour |
|---|---|
| `9.3` (DN) | Cached in `businesses.wrapp_billing_book_dn_id` |
| `1.1`, `2.1`, … (sales) | Cached in `businesses.wrapp_billing_book_inv_id` |
| `1.3` / `1.5` / `5.1` / `5.2` (reversals) | **Cache bypassed** — resolved fresh on every call |

Reversals bypass the cache because the cached "universal" book id would mismatch their
exact type. The few extra GETs per credit invoice are negligible compared to the 422
failures they prevent. Cache writes are best-effort (`.catch` → WARN log, never fatal).

---

## 7. Invoice Transmission

`transmitInvoice(invoice, invoiceLines, biz, customer)` — `src/services/wrapp.service.js:664`
Called from `src/services/invoice.service.js` `transmit()` (manual endpoint
`POST /api/invoices/:id/transmit` and the auto-transmit cron).

### 7.1 Type-code resolution & the 1.3 → 1.5 remap

```js
let typeCode = invoice.invoice_type || '1.1';
if (typeCode === '1.3') typeCode = '1.5';   // remapped ON THE WIRE, logged
```

**Why:** myDATA code `1.3` means *non-EU sales invoice* — **not** credit invoice. An early
version of our credit-invoice route stored `1.3` by mistake. The correct code for a
non-correlated credit is **`1.5`** («Πιστωτικό Τιμολόγιο μη συσχετιζόμενο»). The remap
keeps old DB rows transmitting cleanly; a startup migration also rewrites `1.3 → 1.5` in
the DB (see `src/server.js`), and `invoice.service.js` self-heals at `transmit()` entry.

### 7.2 Reversal handling (credits / cancellations)

```js
const isReversal = ['1.4', '1.5', '5.1', '5.2'].includes(typeCode);
```

myDATA semantics for reversal documents:

- Amounts on the wire must be **POSITIVE** — our DB stores them **negative** (so balance
  reports subtract naturally). Every quantity/price/total goes through `Math.abs()`.
- If the credit references an original invoice (`invoice.related_invoice_id`), we look up
  the original's MARK (`mydata_mark` first, `wrapp_mark` fallback) and send:

```js
payload.correlated_invoices = [String(correlatedMark)];
```

A failed mark lookup logs a WARN and transmits *without* correlation (valid for 1.5/5.2).

### 7.3 Full payload — field by field

```jsonc
{
  "billing_book_id":      "<resolved id — §6>",
  "invoice_type_code":    "1.1",                  // after 1.3→1.5 remap
  "payment_method_type":  0,                      // PM_MAP — see below
  "counterpart": {
    "name":         "safeText(customer.name)",            // 'ΑΓΝΩΣΤΟ' fallback
    "country_code": "GR",
    "vat":          "safeText(customer.afm, '000000000')", // 9-zero fallback for retail
    "city":         "safeText(customer.city)",
    "street":       "safeText(stripStreetNumber(address))",// street WITHOUT number
    "number":       "parseStreetNumber(address)",          // '7Α', '7-9', fallback '0'
    "postal_code":  "safePostal(customer.postal_code)"     // exactly 5 digits, '00000' fallback
  },
  "net_total_amount":     12.34,    // Math.abs(invoice.net_value), 2 decimals
  "vat_total_amount":     1.60,     // Math.abs(invoice.vat_amount)
  "total_amount":         13.94,    // Math.abs(invoice.total_value)
  "payable_total_amount": 13.94,
  "invoice_lines":        [ /* §7.5 */ ],
  "notes":                "…",      // only if invoice.notes non-empty; sliced to 1000 chars
  "correlated_invoices":  ["400001234567890"]   // reversals with a known original MARK only
}
```

### 7.4 Payment method mapping

```js
const PM_MAP = { cash: 0, credit_card: 3, card: 3, bank_transfer: 2, check: 4, iris: 7, other: 1 };
const pm = PM_MAP[invoice.payment_method] ?? 1;
```

| FishBill value | Wrapp `payment_method_type` | myDATA meaning |
|---|---|---|
| `cash` | 0 | Μετρητά |
| `other` (or unknown) | 1 | Επί πιστώσει / λοιπά |
| `bank_transfer` | 2 | Κατάθεση σε τράπεζα |
| `credit_card` / `card` | 3 | Κάρτα |
| `check` | 4 | Επιταγή |
| `iris` | 7 | IRIS άμεσης πληρωμής |

> NOTE: this map is Wrapp-specific. The e-Timologiera path in `invoice.service.js` uses a
> *different* map — do not unify them.

### 7.5 Invoice lines

Each DB line maps to:

```js
{
  line_number:             idx + 1,                       // 1-based
  name:                    (l.description || 'Είδος').slice(0, 200),
  quantity:                Math.abs(parseFloat(l.quantity) || 1),
  quantity_type:           unitCode(l.unit),              // kg=2, τεμ=1, lt=3, gr=4 — §14
  unit_price:              /* abs, 2 dec */,
  net_total_price:         /* abs, prefers l.net_value, else qty*price − discount */,
  vat_rate:                l.vat_rate || 13,              // fish default 13%
  vat_total:               /* abs, prefers l.vat_amount, else net*rate/100 */,
  subtotal:                /* abs, prefers l.total_value, else net+vat */,
  classification_category: 'category1_1',                 // myDATA income classification
  classification_type:     'E3_561_001',                  //  (sales of goods/services)
  vat_exemption_code:      27                             // ONLY when vat_rate === 0
}
```

`vat_exemption_code: 27` = «Λοιπές απαλλαγές» — required by myDATA whenever a line has 0%
VAT, otherwise AADE rejects the document.

### 7.6 Response handling

```jsonc
// Synchronous success:
{ "id": "uuid", "my_data_mark": "4000…", "my_data_uid": "…", "my_data_qr_url": "https://…" }
// Async (myDATA slow):
{ "status": "pending", "invoice_id": "uuid" }
```

We accept the id from `data.id || data.invoice_id` and return:

```js
{ wrapp_invoice_id, mark, uid, qrUrl, pending }   // mark/uid/qrUrl null when pending
```

`invoice.service.js` persists: `status='transmitted'`, `mydata_mark`, `mydata_uid`,
`wrapp_invoice_id`, `wrapp_qr_url`, **NULLs `pdf_path` + `wrapp_pdf_url`** and unlinks any
stale local PDF file (Wrapp owns the legal PDF — §10), and inserts a `transmission_logs`
row with `provider='wrapp'`. When `pending`, the MARK arrives later via webhook (§11.3).

---

## 8. Delivery Note Transmission (9.3)

`transmitDeliveryNote(note, noteLines, biz)` — `src/services/wrapp.service.js:525`
Called from `POST /api/delivery-notes/:id/transmit` (`delivery-notes.routes.js:614`) and
the auto-transmit cron. DNs are myDATA type **9.3** (Δελτίο Αποστολής) with
`is_delivery_note: true`.

### 8.1 The Athens timezone problem (and fix)

Wrapp/myDATA validate `dispatch_date` + `dispatch_time` against the document's *issue
time* **in Europe/Athens local time**. Our server runs in **UTC** — naive
`new Date().getHours()` is 2–3 h behind Athens, causing
`422 "dispatch time must be greater than or equal to invoice issue time"` (worst in summer
DST). The fix — compute everything explicitly in Athens time via `Intl.DateTimeFormat`
(`athensParts()`, §14):

```js
const athensTodayParts = athensParts(new Date());                  // Athens "today"
const isClampedToToday = dispatchMs < athensTodayMs;               // past date? clamp.

if (isClampedToToday) {
  const p = athensParts(new Date(), 2);          // Athens NOW + 2-minute forward buffer
  dispatchDateFmt       = `${p.year}-${p.month}-${p.day}`;
  effectiveDispatchTime = `${p.hour}:${p.minute}`;
} else {
  // future dispatch: keep the user's chosen date and HH:MM (default '08:00')
}
```

- **+2-minute buffer**: guarantees dispatch time > issue time even if Wrapp-side
  processing takes a moment.
- `athensParts` also fixes the Intl quirk where hour `'24'` is returned at midnight → `'00'`.
- Date is then formatted `DD-MMM-YYYY` (e.g. `12-Jun-2026`) by `formatDispatchDate()` —
  the format Wrapp expects for `dispatch_date`.

### 8.2 `delivery_detail` — field by field

```jsonc
{
  "dispatch_date":       "12-Jun-2026",                       // DD-MMM-YYYY (English month)
  "dispatch_time":       "14:37",                             // HH:MM, Athens local (+2 min when clamped)
  "vehicle_number":      "safeText(note.vehicle_plate, 'ΑΓΝΩΣΤΟ')",
  "purpose_of_movement": "1",                                 // movementPurposeCode() — §14
  "issuer_of_movement":  "safeText(biz.name)",
  "from_address":        "safeText(stripStreetNumber(biz.address))",
  "from_number":         "parseStreetNumber(biz.address)",
  "from_city":           "safeText(biz.city)",
  "from_zipcode":        "safePostal(biz.postal_code)",
  "to_address":          "safeText(stripStreetNumber(note.delivery_location || note.recipient_address))",
  "to_number":           "parseStreetNumber(…same…)",
  "to_city":             "safeText(note.recipient_city)",
  "to_zipcode":          "safePostal(note.recipient_postal)"
}
```

myDATA requires **street and number in separate fields** — hence the
`stripStreetNumber` / `parseStreetNumber` pair (handles «Ερμού 7», «7 Ερμού», «Ερμού 7Α»,
«Ερμού 7-9»; falls back to `'0'`).

### 8.3 Full DN payload

```jsonc
{
  "billing_book_id":      "<book for 9.3 — cached in wrapp_billing_book_dn_id>",
  "invoice_type_code":    "9.3",
  "payment_method_type":  1,                  // fixed — DNs carry no payment
  "counterpart": { /* recipient — same helper pattern as §7.3, vat fallback '000000000' */ },
  "is_delivery_note":     true,
  "delivery_detail":      { /* §8.2 */ },
  "net_total_amount":     /* from buildTotals(lines) */,
  "vat_total_amount":     …,
  "total_amount":         …,
  "payable_total_amount": …,
  "invoice_lines":        [ /* buildLines(noteLines) — same shape as §7.5, vat_rate||0 */ ],
  "notes":                "…"                 // only when note.notes is real text; 1000-char cap
}
```

Response handling is identical to invoices (§7.6): `{ wrapp_invoice_id, mark, uid, qrUrl, pending }`.
The route persists `mydata_mark`, `mydata_uid`, `wrapp_qr_url`, `wrapp_invoice_id`,
`status='transmitted'`.

### 8.4 Idempotency

DNs are stamped with a **`client_ref`** (`dn_local_{timestamp}_{random}`) *before* the
first network call — created either by the Android app (offline queue) or the route. The
create endpoint rejects duplicates by `client_ref`, which is what fixed the historical
"double DN" bug (one tap → two documents).

---

## 9. Delivery Note Cancellation

`cancelDeliveryNote(wrappInvoiceId, businessId)` — `src/services/wrapp.service.js:843`
Called from `PATCH /api/delivery-notes/:id/cancel` (`delivery-notes.routes.js:513`).

> Per Wrapp Invoice API v1.13.0, **`DELETE /invoices/:id/cancel` is for delivery notes
> only**. Invoice "cancellation" in FishBill is instead modelled as a credit/reversal
> document (§7.2) — that is the myDATA-correct approach.

**Request:**

```http
DELETE {baseUrl}/api/v1/invoices/{wrapp_invoice_id}/cancel
Authorization: Bearer <jwt>
```

**Response fields:**

| Field | Meaning | What we do |
|---|---|---|
| `id` | The cancelled invoice's Wrapp id | sanity check |
| `my_data_mark` | The **ORIGINAL** DN's MARK (already in our DB) | returned as `originalMark` |
| `cancelled_by_mark` | The **CANCELLATION** MARK — the legally important one | stored in `delivery_notes.cancellation_mark` |
| `status: "pending"` | myDATA slow — real `cancelled_by_mark` arrives via webhook | route stores `cancellation_pending=1`; webhook branch §11.2 completes it |

Return shape: `{ id, cancellationMark, originalMark, pending }`.

---

## 10. Official PDFs

**Principle: FishBill never generates the legal PDF for a Wrapp business.** The provider's
PDF (with QR + provider signature) is the only legally valid artefact.

### 10.1 `GET /api/v1/invoices/:id/generate_pdf`

`generatePdf(wrappInvoiceId, businessId)` — `src/services/wrapp.service.js:996`

```http
GET {baseUrl}/api/v1/invoices/{wrapp_invoice_id}/generate_pdf
Authorization: Bearer <jwt>
```

- Response contains `download_url` → `{ download_url, pending: false }`.
- No `download_url` → Wrapp queued generation → `{ pending: true }`; the URL arrives via
  the **PDF-ready webhook** (§11.1).

### 10.2 The 3-layer PDF route strategy

Both `GET /api/invoices/:id/pdf` (`invoices.routes.js:~1167`) and
`GET /api/delivery-notes/:id/pdf` (`delivery-notes.routes.js:751`) follow the same logic:

```
1. business.wrapp_enabled?
   ├─ NO  → serve local pdf_path (legacy/e-Timologiera businesses), else render locally
   └─ YES →
      a. stale local pdf_path?      → NULL it in DB + unlink file (auto-cleanup), never serve
      b. wrapp_pdf_url cached?      → 302 redirect to it
      c. wrapp_invoice_id present?  → call generatePdf():
             download_url  → cache in wrapp_pdf_url + 302 redirect
             pending       → HTTP 202 «το PDF ετοιμάζεται…» (app retries)
             Wrapp error   → HTTP 503 Greek "temporary failure" message
      d. not transmitted yet        → HTTP 409 «Διαβιβάστε το πρώτα για να εκδοθεί το επίσημο PDF.»
```

On the transmit path, `invoice.service.js` proactively **NULLs `pdf_path` + `wrapp_pdf_url`
and unlinks the disk file** so a re-transmitted/credited document can never serve a stale
FishBill-rendered PDF (this was the root cause of the "credit invoice still shows FishBill
PDF" bug — §17.4).

---

## 11. Webhook Reference

**Endpoint:** `POST /api/wrapp/webhook` — defined in `src/app.js`, **registered before
CORS, helmet, and all rate limiters**, because Wrapp's servers send unknown `Origin`
headers and must never be rate-limited or CORS-blocked. A `GET` probe on the same path
returns `{ ok: true … }` so reachability can be verified from a browser.

Field extraction is tolerant of both snake_case and camelCase, and of Wrapp's three id
spellings:

```js
const wrapp_invoice_id = body.id || body.invoice_id || body.wrapp_invoice_id || null;
```

Branches are evaluated **in order** — first match wins:

### 11.1 PDF-ready branch — `download_url && wrapp_invoice_id`

Looks up `invoices` then `delivery_notes` by `wrapp_invoice_id` and stores
`wrapp_pdf_url = download_url`. Not found → `{ ok:false, error:'Document not found.' }`
(still HTTP 200 — see §11.5).

### 11.2 Cancellation-MARK branch — `cancelled_by_mark && wrapp_invoice_id`

Completes an async DN cancel (§9): finds the DN by `wrapp_invoice_id`, sets
`cancellation_mark = cancelled_by_mark`, clears `cancellation_pending`, sets
`status='cancelled'`.

### 11.3 MARK-update branch — `my_data_mark && wrapp_invoice_id`

Completes an async transmit (§7.6/§8.3 `pending` case):

- **Invoices**: sets `mydata_mark`, `mydata_uid`, `wrapp_qr_url`, `status='transmitted'`
  and inserts a `transmission_logs` row (`provider='wrapp', success=1`).
- **Delivery notes**: same fields on `delivery_notes`.

### 11.4 Onboarding branch — fallthrough, requires `api_key`

The default branch when no MARK/PDF fields are present:

1. **Resolve the business** — `partner_user_id` (we sent the businessId as string in
   §4.1) is looked up first; if that fails and `wrapp_user_id` looks like an email,
   fall back to matching business/owner email.
2. Save credentials: `wrapp_api_key`, `wrapp_user_id`, **`wrapp_enabled = 1`**.
3. `wrapp.invalidateCache(businessId)` — force re-login with the new key.
4. **First-time only**: auto-activate the FishBill subscription — **12 + 1 bonus months**
   (the Wrapp-partner deal) — and log «Subscription auto-activated via Wrapp webhook».

### 11.5 Always answer 200

Every branch — including unresolvable businesses and missing `api_key` — returns
**HTTP 200** with `{ ok: false, error: … }` in the body when something is wrong. A non-200
would make Wrapp retry indefinitely; we log the failure to `wrapp.log` instead and
investigate from there.

---

## 12. Subscription Status Check

`checkUserStatus(businessId)` — `src/services/wrapp.service.js:966`
Used by the admin panel and the user-facing `GET /api/settings/wrapp/status` to show
whether the fisherman's Wrapp contract is active.

```http
POST {baseUrl}/api/v1/embedded_check_user
X-PARTNER-API-KEY: <wrapp_partner_api_key>

{ "partner_user_id": "<businessId as string>" }
```

Returns `{ email: resp.data.user, active_subscription: bool }`. If the partner key is not
configured, returns `{ active_subscription: false }` without calling Wrapp (graceful
degradation, WARN logged).

---

## 13. Auto-Transmit Cron

`src/jobs/autoTransmit.js` — started from `server.js` after migrations.

- Schedule: **every 60 seconds** (`* * * * *`) + one immediate run at boot.
- For each business with `wrapp_enabled = 1`:
  - Up to **20 pending invoices** (`status IN ('draft','issued','failed')`) →
    `invoiceSvc.transmit()` (which routes to Wrapp per §7).
  - Up to **20 pending delivery notes** → `wrapp.transmitDeliveryNote()` + DB updates.
- All activity logged with the `[AUTO_TX]` tag in `wrapp.log`.
- Failures mark the document `status='failed'` with `last_error`, and the next cron tick
  retries it (failed docs are included in the pickup query).

This is why a fisherman can work fully **offline** on the boat: the Android app queues
documents locally (Room), syncs them when back online, and the cron guarantees everything
eventually reaches myDATA without any manual «Διαβίβαση» tap.

---

## 14. Helper Function Reference

All in `src/services/wrapp.service.js`.

| Helper | Signature | Behaviour |
|---|---|---|
| `safeText` | `(value, fallback='ΑΓΝΩΣΤΟ')` | Trims; rejects `null`/empty/em-dash-only placeholders (`/^[—–\-]+$/`) → fallback. myDATA rejects em-dash placeholders that pass Wrapp's input check. |
| `safePostal` | `(value)` | Strips non-digits; exactly 5 digits passes; >5 truncates; otherwise `'00000'` (numeric placeholder AADE accepts). |
| `parseStreetNumber` | `(address)` | Extracts trailing **or** leading street number incl. Greek/Latin letter suffix and ranges (`7Α`, `7-9`, `7/9`); fallback `'0'`. |
| `stripStreetNumber` | `(address)` | Removes the parsed number from the address so the digit is never sent in both `street` and `number`; em-dash-only → `'ΑΓΝΩΣΤΟ'`. |
| `unitCode` | `(unit)` | myDATA `quantity_type`: `τεμ/pcs→1`, `kg/κιλά→2` *(default)*, `lt/λίτρο→3`, `gr/γραμμάρια→4`. |
| `movementPurposeCode` | `(purpose)` | Greek keyword → myDATA movement code: πώληση→1, επιστροφή→2, απόδειξη→3, φύλαξη→4, μεταφορά→7; numeric 1-20 passthrough except reserved {6,15,16,17,18}; default `'1'`. |
| `athensParts` | `(date, offsetMinutes=0)` | Europe/Athens Y/M/D/H/M via `Intl.DateTimeFormat`; fixes `hour==='24'→'00'`; the `offsetMinutes` arg implements the +2 min dispatch buffer. |
| `formatDispatchDate` | `('YYYY-MM-DD')` | → `DD-MMM-YYYY` with English month abbreviations (`MONTHS_EN`). |
| `buildLines` | `(lines, isDn)` | Maps DB lines → Wrapp `invoice_lines` (§7.5 shape), DN default VAT 0. |
| `buildTotals` | `(wrappLines)` | Sums `net_total_price`/`vat_total` with 2-decimal rounding → `{ net, vat, total }`. |
| `wrappRequest` | `(axiosConfig)` | The single HTTP gateway — logs every request/response (§16), redacts JWT to 20 chars and partner key to 8 chars, truncates bodies to 2 000 chars, measures latency, rethrows. |

---

## 15. Database Schema (Wrapp Columns)

Added idempotently at startup by `runMigrations()` in `src/server.js`
(`addColumnIfMissing` pattern — safe to run on every boot).

### `businesses`

| Column | Purpose |
|---|---|
| `wrapp_enabled` (TINYINT) | Master switch — set to 1 by the onboarding webhook |
| `wrapp_api_key` | Per-business Invoice API key (from webhook) |
| `wrapp_user_id` | Wrapp-side user id (from webhook) |
| `wrapp_billing_book_inv_id` | Cached billing book id for sales invoices |
| `wrapp_billing_book_dn_id` | Cached billing book id for 9.3 DNs |

### `invoices` / `delivery_notes`

| Column | Purpose |
|---|---|
| `wrapp_invoice_id` | Wrapp document UUID — the join key for all webhooks |
| `wrapp_pdf_url` | Cached official PDF `download_url` |
| `wrapp_qr_url` | myDATA QR URL (`my_data_qr_url`) |
| `mydata_mark` / `mydata_uid` | Official MARK + UID (shared with the e-Timologiera path) |
| `cancellation_mark` (DN only) | `cancelled_by_mark` from cancel/webhook |
| `cancellation_pending` (DN only) | 1 while waiting for the async cancellation webhook |
| `client_ref` (DN) | Idempotency key (§8.4) |

### `platform_settings`

`wrapp_partner_api_key`, `wrapp_base_url`, `wrapp_webhook_endpoint` (§3).

### Data corrections (startup)

`UPDATE invoices SET invoice_type='1.5' WHERE invoice_type='1.3'` — the permanent fix for
§17.3, paired with the on-the-wire remap.

---

## 16. Logging & Diagnostics

Everything Wrapp-related writes to **`logs/wrapp.log`** *and* the console (so both the
file and Coolify's log stream capture it). Format:

```
[2026-06-12T10:15:42.123Z] [INFO] [HTTP-OUT] → POST https://staging.wrapp.ai/api/v1/invoices {...}
```

| Tag | Source |
|---|---|
| `[HTTP-OUT]` / `[HTTP-IN]` | Every outgoing request / response (or error) via `wrappRequest`, with latency ms |
| `[WEBHOOK]` | Every inbound webhook hit, parsed fields, branch taken (`app.js` `_wlog`) |
| `[getJwt]`, `[createBillingBook]`, `[fetchBillingBookId]`, `[getBillingBookId]` | Auth + book resolution |
| `[transmitInvoice]`, `[transmitDeliveryNote]`, `[cancelDeliveryNote]`, `[generatePdf]` | Document operations (START → payload summary → SUCCESS/PENDING) |
| `[initiateOnboarding]`, `[checkUserStatus]`, `[invalidateCache]` | Partner API operations |
| `[INVOICE_TX]` | `invoice.service.js` transmit pipeline |
| `[AUTO_TX]` | Auto-transmit cron |

**Redaction rules:** JWTs truncated to 20 chars, API keys to 8-char prefix, bodies to
2 000 chars, staging basic-auth credentials never logged (stripped from the URL before
logging). Debugging a failed transmit is always: `grep <invoice id or wrapp_invoice_id>
logs/wrapp.log` → the full request payload and Wrapp's exact 422 body are there.

---

## 17. Known Pitfalls & How We Solved Them

Hard-won production/staging lessons — **do not regress these**:

### 17.1 — 422 «dispatch time must be ≥ invoice issue time»
Server runs UTC, Wrapp validates in Europe/Athens. **Fix:** `athensParts()` +
clamp-past-dates-to-today + **+2 min** forward buffer (§8.1).

### 17.2 — Billing book 422 «Name/Series ήδη χρησιμοποιήσει»
A previous create attempt left a book with the same name/series (possibly under a
normalised type). **Fix:** catch the 422, `GET` the list, reuse by name-or-series (§6.2).

### 17.3 — The 1.3 billing-book loop
Credits were stored as type `1.3` (actually *non-EU sales* in myDATA). Wrapp silently
normalises a created 1.3 book to 1.1, so the next POST hits «Invoice Type does not match
selected Billing Book Invoice Type», forever. **Fix (three layers):** wire remap 1.3→1.5,
DB migration 1.3→1.5, reversal types bypass the billing-book cache and never use prefix
fallback (§6.3–6.4, §7.1).

### 17.4 — Credit invoice served a FishBill PDF instead of Wrapp's
A stale `pdf_path` from before the Wrapp migration shadowed the official PDF. **Fix:**
transmit NULLs `pdf_path`/`wrapp_pdf_url` + unlinks the file; the PDF route checks
`wrapp_enabled` FIRST and auto-cleans stale paths (§10.2).

### 17.5 — Duplicate delivery notes
Double-tap / retry created two identical DNs. **Fix:** `client_ref` idempotency stamped
before the first network call (§8.4).

### 17.6 — em-dash placeholders rejected by AADE
`'—'` in address/name fields passes Wrapp validation but AADE rejects it downstream.
**Fix:** `safeText` strips `/^[—–\-]+$/` → `'ΑΓΝΩΣΤΟ'` (§14).

### 17.7 — Greek series letters rejected
Billing book `series` must be Latin. **Fix:** the SERIES map uses only Latin letters (§6.1).

### 17.8 — Webhook blocked by CORS / rate limiting
Wrapp sends unpredictable Origin headers. **Fix:** webhook registered before *all*
middleware; always responds 200 (§11, §11.5).

### 17.9 — 0% VAT lines rejected
myDATA requires an exemption reason. **Fix:** `vat_exemption_code: 27` auto-attached to
every 0-VAT line (§7.5).

---

## 18. Compliance Verification

- **[`WRAPP-API-COMPLIANCE-AUDIT.md`](./WRAPP-API-COMPLIANCE-AUDIT.md)** — clause-by-clause
  audit of our implementation against Wrapp Invoice API v1.13.0, scored **100/100**.
- **[`scripts/verify-wrapp-compliance.js`](./scripts/verify-wrapp-compliance.js)** —
  **83 automated assertions** over the actual source (payload shapes, helper behaviour,
  PM_MAP values, timezone math, billing-book rules, webhook branches). Run with:

  ```bash
  node scripts/verify-wrapp-compliance.js
  # → 83/83 PASS
  ```

  Run it after **any** change to `wrapp.service.js`, the webhook in `app.js`, or the
  transmit pipeline in `invoice.service.js`.

---

*Document generated for FishBill backend — covers Wrapp Invoice API v1.13.0 & Partners API v2.1 integration as implemented in `src/services/wrapp.service.js`, `src/app.js` (webhook), `src/jobs/autoTransmit.js`, `src/services/invoice.service.js`, `src/routes/invoices.routes.js`, `src/routes/delivery-notes.routes.js`, `src/routes/settings.routes.js`.*
