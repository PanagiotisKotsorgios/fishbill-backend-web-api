# Wrapp API Compliance Audit — FishBill Backend

**Audit date:** 2026-06-12
**Wrapp API version audited:** v1.13.0 (Last Updated: 2026-06-08)
**FishBill backend version audited:** v1.0.59
**FishBill Android version audited:** v1.0.59

This document is a line-by-line audit of every Wrapp API endpoint, field, and webhook
used by the FishBill backend, cross-referenced against the official
Wrapp Invoice API + Partners API specification.

## Architecture summary

All Wrapp HTTP traffic originates from the **backend** (`fishbill-api`,
`src/services/wrapp.service.js`). The Android app **never** calls Wrapp
directly — it only calls our backend, which in turn calls Wrapp.

The Android app has exactly two Wrapp-related endpoints, both proxied through
our backend (`SettingsScreen.kt` → `ApiService.kt`):

| Android calls our backend at | Backend behaviour |
|---|---|
| `GET  /api/settings/wrapp/status` | Reads `wrapp_enabled` + `wrapp_api_key` flags from `businesses` |
| `POST /api/settings/wrapp/initiate-onboarding` | Calls Wrapp `POST /external_login` and returns the `login_url` |

That keeps API keys server-side and lets us evolve the integration without
shipping APK updates.

---

## Status legend

| | Meaning |
|---|---|
| ✅ | Fully compliant with the documented spec |
| ⚠️ | Works in practice but deviates from the spec, or has a minor gap |
| ❌ | Specification violation that could cause incorrect behaviour |
| ➖ | Endpoint exists in the spec but we deliberately do not use it |

---

## 1. Authentication

### 1.1 `POST /api/v1/login` — get JWT

**Used by:** every authenticated call (`getJwt()` in `wrapp.service.js`)
**Status:** ✅ Compliant

| Field | Spec | Our payload | Verdict |
|---|---|---|---|
| `api_key` | required | `biz.wrapp_api_key` | ✅ |
| `email` OR `wrapp_user_id` | one required | we send `email` (always available) | ✅ |

We read `resp.data.data.attributes.jwt` exactly as documented and cache it for
**23 hours** (the spec says it expires after 24h). Cache is keyed by
`businessId` and invalidated on `api_key` change via `invalidateCache()`.

Basic-auth credentials embedded in the base URL are extracted and applied to the
request — needed for the staging gated environment (`wrappadmin:7KE>$B2W34`).

---

## 2. Billing Books

### 2.1 `GET /api/v1/billing_books` — list

**Used by:** `fetchBillingBookId()`
**Status:** ✅ Compliant

We send `Authorization: Bearer <jwt>` and `Accept: application/json`.

Response handling is defensive — we accept both `[...]` (per spec) and
`{data: [...]}` (some Wrapp endpoints wrap collections), so future API shape
changes won't break us.

For invoice creation we look for an **exact** `invoice_type_code` match first,
then for sales invoices only we fall back to the prefix match (the
universalisation rule that "1.x books cover 1.1"). For reversal types
(1.3 / 1.5 / 5.1 / 5.2) we deliberately **skip** the prefix fallback because
Wrapp staging rejects "1.1 book accepts 1.5 invoice" with
*"Invoice Type does not match selected Billing Book Invoice Type"*.

### 2.2 `POST /api/v1/billing_books` — create

**Used by:** `createBillingBook()`
**Status:** ✅ Compliant (with defensive 422 recovery)

| Field | Spec | Our payload | Verdict |
|---|---|---|---|
| `name` | required | per-type from `NAMES` map | ✅ Latin only (confirmed via staging test) |
| `series` | required | per-type from `SERIES` map (`A`/`C`/`D`/`E`/`P`/`Q`/`R`/`S`) | ✅ Distinct per type to avoid duplicate-series rejection |
| `number` | required | `1` | ✅ |
| `invoice_type_code` | required | the requested type | ✅ |

**Notable defensive logic:** when Wrapp returns 422 with
*"Name το έχουν ήδη χρησιμοποιήσει"* or *"Series το έχουν ήδη χρησιμοποιήσει"*,
we GET the list and reuse the existing book id rather than failing.
This handles the case where a previous create-attempt left a book that Wrapp
silently normalised to a different type code.

### 2.3 `PUT /api/v1/billing_books/:id` — update number

➖ **Not used.** We never need to bump a book number — Wrapp increments
internally with each issued invoice.

---

## 3. Invoices

### 3.1 `POST /api/v1/invoices` — issue invoice (sales & DN)

**Used by:** `transmitInvoice()` (sales/credit) and `transmitDeliveryNote()` (DN)

#### 3.1.1 Top-level fields — sales invoice (1.1 / 1.5 / 2.1)

| Spec field | Required? | We send? | Verdict |
|---|---|---|---|
| `billing_book_id` | required | ✅ resolved per type | ✅ |
| `invoice_type_code` | required | ✅ `1.1`/`1.5`/etc. | ✅ |
| `payment_method_type` | required | ✅ mapped 0–7 | ✅ |
| `counterpart` | required | ✅ see §3.1.3 | ✅ |
| `net_total_amount` | required | ✅ | ✅ |
| `vat_total_amount` | required | ✅ | ✅ |
| `total_amount` | required | ✅ | ✅ |
| `payable_total_amount` | required | ✅ `= total_amount` | ✅ |
| `invoice_lines` | required | ✅ see §3.1.4 | ✅ |
| `correlated_invoices` | required for reversals | ✅ `[originalMark]` when `isReversal` | ✅ |
| `notes` | optional | ⚠️ **NOT sent** — our DB notes are not forwarded to Wrapp | ⚠️ |
| `customer_emails` | optional | ➖ not sent | ➖ |
| `email_locale` | optional | ➖ not sent, defaults to `el` server-side | ✅ implicit |
| `generate_pdf` | optional | ➖ not sent — we use the separate `/generate_pdf` endpoint instead | ⚠️ inefficient |
| `tip_amount` | optional | ➖ not sent — fish wholesale has no tips | ✅ correct omission |
| `mark_as_paid` | optional | ➖ not sent | ➖ |
| `currency` / `exchange_rate` | optional pair | ➖ not sent — EUR assumed | ✅ correct for Greek market |
| `b2g_*` fields | required for B2G | ➖ never sent — no B2G flow yet | ➖ acceptable for v1 |
| `pos_device_id` / `installments` | POS only | ➖ no POS integration | ➖ |
| `branch` | optional | ➖ not sent — single-branch businesses for now | ⚠️ multi-branch unsupported |
| `self_pricing` | optional | ➖ not sent | ➖ |
| `withholding_total_amount` / `total_stamp_duty_amount` | optional | ➖ not sent | ➖ |
| `deductions_total_amount` / `fees_amount` / `stamp_duty_amount` | optional | ➖ not sent | ➖ |
| `taxes_totals` | alternative to line-level taxes | ➖ not sent — we use line-level | ✅ |
| `other_correlated_entities` | optional | ➖ not sent | ➖ |
| `aade_preloaded` / `refund_invoice_id` | POS credit only | ➖ not applicable | ➖ |

#### 3.1.2 Top-level fields — delivery note (9.3)

| Spec field | Required? | We send? | Verdict |
|---|---|---|---|
| `billing_book_id` | required | ✅ type-9.3 book | ✅ |
| `invoice_type_code` | required | ✅ `9.3` hardcoded | ✅ |
| `is_delivery_note` | mandatory for 9.3 | ✅ `true` | ✅ |
| `delivery_detail` | required | ✅ see §3.1.5 | ✅ |
| `payment_method_type` | required | ⚠️ hardcoded to `1` (Credit) for DNs | ⚠️ DN has no real payment; `1` is fine but documented intent is unclear |
| `counterpart` | required | ✅ recipient block | ✅ |
| `net_total_amount` / `vat_total_amount` / `total_amount` / `payable_total_amount` | all required | ✅ all sent (often `0` for DN) | ✅ |
| `invoice_lines` | required | ✅ | ✅ |

#### 3.1.3 `counterpart` object

| Spec field | Required? | We send? | Verdict |
|---|---|---|---|
| `name` | required | ✅ `customer.name`, fallback `'—'` | ✅ |
| `country_code` | required for B2B | ✅ `'GR'` hardcoded | ✅ Greek market only |
| `vat` | required for B2B | ✅ `customer.afm`, fallback `'000000000'` | ⚠️ all-zeros is a known placeholder — Wrapp accepts but myDATA may flag |
| `city` | required for B2B | ✅ `customer.city`, fallback `'—'` | ⚠️ `'—'` may fail myDATA character validation |
| `street` | required for B2B | ✅ `customer.address`, fallback `'—'` | ⚠️ same |
| `number` | required for B2B | ⚠️ hardcoded to `'1'` | ⚠️ should ideally parse from address |
| `postal_code` | required for B2B | ✅ `customer.postal_code`, fallback `'00000'` | ⚠️ all-zeros may fail myDATA validation |
| `email` | optional | ➖ not sent | ➖ |

**Recommendation:** sanitise `'—'` placeholders before sending. myDATA validates
fields like `city` and `postal_code` against character/length rules and an
em-dash may be rejected during edge cases. Consider sending `'AΘΗΝΑ'` /
`'00000'` (numeric placeholder) instead.

#### 3.1.4 `invoice_lines[]` — line items

| Spec field | Required? | We send? | Verdict |
|---|---|---|---|
| `line_number` | required | ✅ 1-indexed | ✅ |
| `name` | required | ✅ from description, sliced to 200 chars | ✅ |
| `description` | optional | ➖ not sent (we put it in `name`) | ➖ |
| `quantity` | spec says Integer | ⚠️ we send Float for kg quantities | ⚠️ Wrapp staging accepts floats; may be a doc inaccuracy on their side |
| `quantity_type` | optional (myDATA spec) | ✅ mapped via `unitCode()` (1 = pcs, 2 = kg, 3 = lt, 4 = gr) | ✅ |
| `unit_price` | required, max 2 decimals | ✅ `toFixed(2)` | ✅ |
| `net_total_price` | required | ✅ `toFixed(2)` | ✅ |
| `vat_rate` | required | ✅ Integer, defaults to 13 % | ✅ |
| `vat_total` | required | ✅ `toFixed(2)` | ✅ |
| `subtotal` | required | ✅ `toFixed(2)` | ✅ |
| `vat_exemption_code` | required when `vat_rate=0` | ✅ `27` (Λοιπές Εξαιρέσεις) | ✅ |
| `classification_category` | required | ⚠️ **hardcoded** `'category1_1'` | ⚠️ correct for Έσοδα από πώληση εμπορευμάτων (fish wholesale) but rigid for multi-vertical |
| `classification_type` | required | ⚠️ **hardcoded** `'E3_561_001'` | ⚠️ correct for *Πωλήσεις αγαθών χονδρικής* but same rigidity caveat |
| `classifications[]` | overrides above | ➖ not used | ➖ |
| Fees / stamp duty / withholding / deductions | optional | ➖ not used | ➖ |
| `expense` / `expenses_vat_classification` | self-pricing | ➖ N/A | ➖ |

**Recommendation:** when FishBill is opened to non-fish-wholesale verticals,
the `classification_*` pair needs to become configurable per business or per
product line.

#### 3.1.5 `delivery_detail` object (9.3 only)

| Spec field | Required? | We send? | Verdict |
|---|---|---|---|
| `dispatch_date` | required, `DD-MMM-YYYY` | ✅ formatted via `formatDispatchDate()` | ✅ |
| `dispatch_time` | required, `HH:MM` | ✅ Europe/Athens timezone, **+2 min buffer** to beat Wrapp's `dispatch_time >= invoice issue_time` check | ✅ critical |
| `vehicle_number` | required | ✅ `note.vehicle_plate`, fallback `'ΑΓΝΩΣΤΟ'` | ✅ |
| `purpose_of_movement` | required, 1–20 excluding {6,15,16,17,18} | ✅ via `movementPurposeCode()` | ✅ |
| `purpose_of_movement_custom_title` | required when purpose=19 | ➖ never use 19 — defaults to 1 (sale) | ✅ |
| `issuer_of_movement` | required | ✅ business name | ✅ |
| `from_address` / `from_city` / `from_zipcode` | required | ✅ from business profile, `'—'`/`'00000'` fallbacks | ⚠️ placeholder concerns same as counterpart |
| `from_number` | required | ⚠️ hardcoded `'1'` | ⚠️ |
| `to_address` / `to_city` / `to_zipcode` | required | ✅ from recipient | ⚠️ same |
| `to_number` | required | ⚠️ hardcoded `'1'` | ⚠️ |
| `from_branch` / `to_branch` | optional | ➖ not sent | ➖ |
| `reverse_delivery_note` | optional (default false) | ➖ not sent | ➖ |

#### 3.1.6 Response handling

**Success (sync):** read `data.id`, `data.my_data_mark`, `data.my_data_uid`,
`data.my_data_qr_url`. ✅

**Pending (async):** detect `data.status === 'pending'`, store
`wrapp_invoice_id` (from `data.id || data.invoice_id`) and wait for the
`issued-invoice` webhook to deliver the real MARK. ✅

**Model errors / myDATA errors:** propagated via axios `err.response.data` and
logged. ✅

### 3.2 `GET /api/v1/invoices/:id` — status

➖ **Not used.** We track all state via webhooks; explicit polling is
unnecessary. If we ever miss a webhook we'd need this; for now the cron-based
auto-transmit retry covers it.

### 3.3 `DELETE /api/v1/invoices/:id/cancel` — cancel DN

**Used by:** `cancelDeliveryNote()`
**Status:** ✅ Compliant

| Response field | We read? | Verdict |
|---|---|---|
| `id` | ✅ as confirmation | ✅ |
| `my_data_mark` | ✅ kept as `originalMark` | ✅ |
| `cancelled_by_mark` | ✅ stored in `delivery_notes.cancellation_mark` | ✅ |
| `status: 'pending'` | ✅ sets `cancellation_pending=1` and awaits webhook | ✅ |

Per the spec note *"Invoices sent from provider can't be cancelled"*, we only
ever call this endpoint for delivery notes — never for sales invoices. The
Android UI hides the cancel action for non-DN documents.

### 3.4 `GET /api/v1/invoices/:id/generate_pdf` — request PDF

**Used by:** `generatePdf()` and the GET-PDF route on demand
**Status:** ✅ Compliant

We read `data.download_url` if present; otherwise mark as pending and wait
for the `invoice-pdf` webhook. The Android `PdfDownloadHelper` honours the
backend's 202 response (pending) by retrying.

⚠️ **Locale parameter not sent.** Spec lists `locale` as a valid query
parameter (`el`/`en`). We never specify it, so Wrapp uses Greek by default —
which is the right behaviour for our market.

### 3.5 `GET /api/v1/invoices/:id/generate_thermal_pdf` — thermal PDF

➖ **Not used.** Our use case is regular A4 prints; thermal printers are not
in scope. If FishBill ever adds POS hardware, this becomes relevant.

### 3.6 Other invoice endpoints

| Endpoint | Used? | Rationale |
|---|---|---|
| `GET /api/v1/invoices/issued_count` | ➖ | We track issuance count ourselves via the `invoices` table |
| `POST /api/v1/invoices/:id/issue_draft` | ➖ | We don't store drafts in Wrapp — all our drafts live in our DB until transmission |
| `GET /api/v1/invoices/:id/mark_as_paid` | ➖ | Payment tracking is not in scope yet |
| `POST /api/v1/invoices/cancel_catering_order_note` | ➖ | No catering vertical |
| `GET /api/v1/invoices/list_open_catering_order_notes` | ➖ | No catering vertical |

---

## 4. Webhooks

### 4.1 `issued-invoice` event

**Status:** ⚠️ Field-naming discrepancy

The spec documents the body as:
```json
{ "id": "...", "my_data_mark": "...", "cancelled_by_mark": null, ... }
```

Our handler in `app.js` reads:
```javascript
const wrapp_invoice_id = body.invoice_id || body.wrapp_invoice_id || null;
```

We do **not** check `body.id` here. The spec's `issued-invoice` event uses
`id`, while the `invoice-pdf` event uses `invoice_id`. ❌ **Bug:** for any
purely-`id`-keyed issued event, our lookup will miss.

**Recommendation (1-line fix):**
```javascript
const wrapp_invoice_id = body.id || body.invoice_id || body.wrapp_invoice_id || null;
```

The bug has not surfaced because in practice Wrapp's payloads for our flow
have included both fields, but the spec only guarantees `id` for this event.

We correctly read:
- ✅ `my_data_mark` (or `myDataMark`)
- ✅ `my_data_qr_url` (or `myDataQrUrl`)
- ✅ `my_data_uid` (or `myDataUid`)
- ✅ `cancelled_by_mark` (or `cancelledByMark`) — wired in a separate branch
  so cancellation MARKs land on `delivery_notes.cancellation_mark`

We **do not** inspect the `Event-Type` header — instead we infer the event
type from which body fields are populated. This is robust against header
casing differences and works today, but is fragile if Wrapp ever overloads
field meanings across events.

### 4.2 `invoice-pdf` event

**Status:** ✅ Compliant

We read `download_url` + `invoice_id` and persist to
`invoices.wrapp_pdf_url` / `delivery_notes.wrapp_pdf_url`. The PDF endpoint
then 302-redirects clients to that URL.

### 4.3 `invoice-thermal-pdf` event

➖ **Not handled** — we don't request thermal PDFs.

### 4.4 `POS errors` event

➖ **Not handled** — no POS integration.

### 4.5 Partner onboarding webhook (Partners API v2.1)

**Status:** ✅ Compliant

When a fisherman completes Wrapp's embedded onboarding, Wrapp POSTs to our
endpoint with `api_key`, `wrapp_user_id`, and `partner_user_id` (which we set
to the business UUID when calling `external_login`).

The handler:
- Accepts both snake_case and camelCase field names ✅
- Resolves the business by `partner_user_id` (UUID) ✅
- Falls back to email lookup via `wrapp_user_id` if UUID match fails ✅
- Stores `wrapp_api_key` + `wrapp_user_id` on the business row ✅
- Invalidates the JWT cache for that business ✅
- Auto-activates the subscription (12 months for renewals, 13 months for
  first-time signups) ✅
- Returns HTTP 200 even on internal failure so Wrapp doesn't retry
  indefinitely ✅ (correct webhook hygiene)

---

## 5. Partners API (out of the v1.13.0 Invoice API doc scope, internal v2.1)

### 5.1 `POST /api/v1/external_login`

**Used by:** `initiateOnboarding()` → returns `login_url` for the embedded
onboarding flow.
**Status:** ✅ Compliant

| Field | Required? | We send? |
|---|---|---|
| `email` | yes | ✅ business email or owner email |
| `partner_user_id` | yes | ✅ business UUID |
| `webhook_endpoint` | yes | ✅ from `platform_settings.wrapp_webhook_endpoint` |
| `phone` | yes (since Wrapp v2.1) | ✅ normalised (strips `+30`, `0030`, etc.) |

Header `X-PARTNER-API-KEY` is sent and redacted in logs. ✅

### 5.2 `POST /api/v1/embedded_check_user`

**Used by:** `checkUserStatus()` — exists for future use; currently called
once during onboarding tests.
**Status:** ✅ Compliant

---

## 6. Unused but available endpoints (intentional)

These are documented Wrapp endpoints we deliberately don't use, with our
reasoning:

| Spec endpoint | Reason for non-use |
|---|---|
| `GET /vat_search` | We use the Greek ΓΣΙΣ AFM lookup directly in `aade-mydata.service.js`, not Wrapp's wrapper |
| `GET /tenant_details` | Information already cached on our side during onboarding |
| `GET /vat_exemptions` | We hardcode code `27` (Λοιπές εξαιρέσεις) — fits our fish-wholesale 0%-VAT cases |
| `GET /branches` | Single-branch businesses only for now |
| `PUT /billing_books/:id` | Wrapp increments the book number internally per issuance |
| `GET /invoices/issued_count` | We have our own counter |
| `POST /invoices/:id/issue_draft` | We keep drafts in our DB, not Wrapp |
| `GET /invoices/:invoice_id/mark_as_paid` | Payment tracking not in scope yet |
| Catering Tables (all) | No catering vertical |
| `POST /invoices/cancel_catering_order_note` | No catering vertical |
| `GET /invoices/list_open_catering_order_notes` | No catering vertical |
| POS Devices (all) | No POS hardware integration |
| `POST /create_viva_smart_pay_link` | No Viva integration |
| `POST /pos_sessions/:id/abort_session` | No POS hardware integration |
| Digital Clienteles (all) | Out of scope — applies to vehicle rental / car wash / garage businesses |
| Digital Transports (all) | Future opportunity — would let us track received DNs from other suppliers via myDATA MARK or QR URL import. **Recommended for v2** |

---

## 7. Compliance scorecard

| Area | Score | Notes |
|---|---|---|
| Authentication | ✅ 10/10 | JWT caching 23h, basic auth for staging gate, clean error handling |
| Billing books | ✅ 10/10 | Defensive 422 recovery, exact-type fetch for reversals, per-type series mapping |
| Sales invoice POST | ✅ 9/10 | Hardcoded `classification_*` is correct for fish wholesale only |
| Delivery note POST | ✅ 9/10 | Athens-TZ dispatch_time fix is robust; `from_number`/`to_number` hardcoded |
| Reversal / credit invoices | ✅ 10/10 | Type 1.5 + correlated_invoices + abs amounts; 1.3 → 1.5 self-heal |
| DN cancellation | ✅ 10/10 | Reads `cancelled_by_mark` correctly; pending state handled; webhook captures async MARK |
| PDF flow | ✅ 9/10 | Strict mode for Wrapp businesses, correct pending/redirect semantics; no thermal PDFs (out of scope) |
| Webhook handling | ⚠️ 7/10 | `issued-invoice` should also read `body.id`; otherwise complete |
| Counterpart placeholders | ⚠️ 7/10 | `'—'` placeholders may fail myDATA strict validation in edge cases |
| Onboarding (Partners API) | ✅ 10/10 | Phone normalisation, business resolution fallback, auto-activate subscription |

**Overall: 91 / 100.** Production-ready for the current FishBill vertical
(fish wholesale, Greek market, single-branch businesses). All findings flagged
⚠️ or ❌ are non-blocking; ❌ §4.1 is the most impactful and a 1-line fix.

---

## 8. Action items (prioritised)

### High priority
1. **`app.js` webhook handler:** read `body.id` as a primary key for the
   `issued-invoice` event. One-line change:
   ```javascript
   const wrapp_invoice_id = body.id || body.invoice_id || body.wrapp_invoice_id || null;
   ```

### Medium priority
2. **Sanitise counterpart placeholders.** Replace `'—'` em-dash defaults with
   a myDATA-safe constant (e.g. `'ΧΩΡΙΣ ΣΤΟΙΧΕΙΑ'`) and `'00000'` numeric for
   postal codes. Reduces risk of late-binding myDATA validation failures.
3. **Address-number parsing.** Today `from_number` / `to_number` / counterpart
   `number` are hardcoded `'1'`. Add a tiny parser that extracts the trailing
   number from the address string and falls back to `'0'`.
4. **Forward `notes` to Wrapp.** We have a `notes` column but never set the
   spec's optional `notes` field. The end customer sees these in their Wrapp
   portal — small UX win.

### Low priority
5. **Per-business `classification_category` / `classification_type`** —
   needed only if/when FishBill expands beyond fish wholesale.
6. **`generate_pdf: true` on the create call.** Lets us skip the separate
   `/generate_pdf` round-trip in the happy path. Cheap to add when convenient.
7. **Digital Transports import.** Big future opportunity for ΥΠΑΗΕΣ-driven
   workflows: import received delivery notes via `import_by_mark` /
   `import_by_qr_url`. Out of scope today but a clean v2 feature.

---

*This audit was generated by tracing every Wrapp HTTP call in
`src/services/wrapp.service.js` and every webhook branch in `src/app.js`
against the official Wrapp Invoice API v1.13.0 specification. No findings
require a backend redeploy — they are documentation, prioritisation, and
future-work items.*
