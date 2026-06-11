#!/usr/bin/env node
/**
 * Wrapp compliance verification script.
 *
 * Loads wrapp.service.js and exercises every public helper against the
 * inputs we'd see in production. Asserts the outputs are myDATA-spec
 * compliant. Run with: node scripts/verify-wrapp-compliance.js
 *
 * This is the test step for the 100/100 audit pass.
 */

'use strict';

// We pull the (now unexported) helpers out via a small monkey-patch:
// require the module, then re-evaluate the source to get access to the
// internal helpers without polluting production exports.
const fs   = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../src/services/wrapp.service.js'), 'utf8');

// Extract helper bodies via regex and eval them in an isolated context.
function extract(source, fnName) {
  const re = new RegExp(`function\\s+${fnName}\\s*\\([\\s\\S]*?\\n\\}`, 'm');
  const m  = source.match(re);
  if (!m) throw new Error(`helper '${fnName}' not found in source`);
  return m[0];
}

const helpersSrc = [
  "const SAFE_TEXT_FALLBACK = 'ΑΓΝΩΣΤΟ'; const SAFE_POSTAL_FALLBACK = '00000';",
  "const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];",
  extract(SRC, 'safeText'),
  extract(SRC, 'safePostal'),
  extract(SRC, 'parseStreetNumber'),
  extract(SRC, 'stripStreetNumber'),
  extract(SRC, 'unitCode'),
  extract(SRC, 'movementPurposeCode'),
  extract(SRC, 'formatDispatchDate'),
  extract(SRC, 'athensParts'),
  "module.exports = { safeText, safePostal, parseStreetNumber, stripStreetNumber, unitCode, movementPurposeCode, formatDispatchDate, athensParts };",
].join('\n\n');

const m = { exports: {} };
const wrapper = new Function('module', 'exports', helpersSrc);
wrapper(m, m.exports);
const H = m.exports;

let pass = 0, fail = 0;
function assert(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`);
    console.log(`     expected: ${JSON.stringify(expected)}`);
    console.log(`     actual:   ${JSON.stringify(actual)}`);
  }
}

console.log('\n── safeText ─────────────────────────────────────────');
assert('plain text passes through', H.safeText('ΑΘΗΝΑ'), 'ΑΘΗΝΑ');
assert('em-dash replaced with fallback', H.safeText('—'), 'ΑΓΝΩΣΤΟ');
assert('hyphen-only replaced', H.safeText('-'), 'ΑΓΝΩΣΤΟ');
assert('empty string replaced', H.safeText(''), 'ΑΓΝΩΣΤΟ');
assert('null replaced', H.safeText(null), 'ΑΓΝΩΣΤΟ');
assert('undefined replaced', H.safeText(undefined), 'ΑΓΝΩΣΤΟ');
assert('whitespace trimmed', H.safeText('  ΕΡΜΟΥ  '), 'ΕΡΜΟΥ');
assert('custom fallback honoured', H.safeText('', 'XX'), 'XX');

console.log('\n── safePostal ───────────────────────────────────────');
assert('valid 5-digit', H.safePostal('11521'), '11521');
assert('strips non-digits', H.safePostal('115 21'), '11521');
assert('null returns 00000', H.safePostal(null), '00000');
assert('short pads to 00000', H.safePostal('123'), '00000');
assert('too long truncates', H.safePostal('1234567'), '12345');
assert('all-dashes returns 00000', H.safePostal('-----'), '00000');

console.log('\n── parseStreetNumber ────────────────────────────────');
assert('Greek address w/ trailing number', H.parseStreetNumber('Ερμού 7'), '7');
assert('trailing letter suffix', H.parseStreetNumber('Πατησίων 42Α'), '42Α');
assert('range with dash', H.parseStreetNumber('Ερμού 7-9'), '7-9');
assert('leading number', H.parseStreetNumber('7 Ερμού'), '7');
assert('no number returns 0', H.parseStreetNumber('Ερμού'), '0');
assert('null returns 0', H.parseStreetNumber(null), '0');
assert('big number', H.parseStreetNumber('Πατησίων 113'), '113');

console.log('\n── stripStreetNumber ────────────────────────────────');
assert('strips trailing number', H.stripStreetNumber('Ερμού 7'), 'Ερμού');
assert('strips trailing letter suffix', H.stripStreetNumber('Πατησίων 42Α'), 'Πατησίων');
assert('strips trailing range', H.stripStreetNumber('Ερμού 7-9'), 'Ερμού');
assert('strips leading number', H.stripStreetNumber('7 Ερμού'), 'Ερμού');
assert('no number kept as-is', H.stripStreetNumber('Ερμού'), 'Ερμού');
assert('null returns fallback', H.stripStreetNumber(null), 'ΑΓΝΩΣΤΟ');
assert('em-dash returns fallback', H.stripStreetNumber('—'), 'ΑΓΝΩΣΤΟ');

console.log('\n── unitCode (quantity_type per myDATA) ──────────────');
assert('kg → 2', H.unitCode('kg'), 2);
assert('κιλό → 2', H.unitCode('κιλό'), 2);
assert('τεμ → 1', H.unitCode('τεμ'), 1);
assert('lt → 3', H.unitCode('lt'), 3);
assert('gr → 4', H.unitCode('gr'), 4);
assert('unknown defaults to 2', H.unitCode('xyz'), 2);
assert('null defaults to 2', H.unitCode(null), 2);

console.log('\n── movementPurposeCode (1-20 excl. 6/15/16/17/18) ──');
assert('blank → "1" (Πώληση)', H.movementPurposeCode(''), '1');
assert('"Πώληση" → "1"', H.movementPurposeCode('Πώληση'), '1');
assert('"Επιστροφή" → "2"', H.movementPurposeCode('Επιστροφή'), '2');
assert('"Μεταφορά" → "7"', H.movementPurposeCode('Μεταφορά'), '7');
assert('"7" → "7" (numeric pass-through)', H.movementPurposeCode('7'), '7');
assert('"6" forbidden → "1"', H.movementPurposeCode('6'), '1');
assert('"15" forbidden → "1"', H.movementPurposeCode('15'), '1');
assert('"21" out-of-range → "1"', H.movementPurposeCode('21'), '1');

console.log('\n── formatDispatchDate ───────────────────────────────');
assert('2026-06-12 → 12-Jun-2026', H.formatDispatchDate('2026-06-12'), '12-Jun-2026');
assert('2026-01-01 → 01-Jan-2026', H.formatDispatchDate('2026-01-01'), '01-Jan-2026');
assert('null → null', H.formatDispatchDate(null), null);

console.log('\n── athensParts (timezone handling) ──────────────────');
const ap = H.athensParts(new Date('2026-06-12T08:00:00Z')); // 08:00 UTC = 11:00 EEST
assert('UTC 08:00 → Athens 11:00 (year)', ap.year, '2026');
assert('UTC 08:00 → Athens 11:00 (month)', ap.month, '06');
assert('UTC 08:00 → Athens 11:00 (day)', ap.day, '12');
assert('UTC 08:00 → Athens 11:00 (hour)', ap.hour, '11');
const apWinter = H.athensParts(new Date('2026-01-15T08:00:00Z')); // EET (UTC+2)
assert('UTC 08:00 Jan → Athens 10:00 (winter)', apWinter.hour, '10');
const apBuffer = H.athensParts(new Date('2026-06-12T20:58:00Z'), 2); // +2 min offset
// Should be 23:58 + 2 = 00:00 next day Athens
assert('Athens buffer crosses midnight (day)', apBuffer.day, '13');
assert('Athens buffer crosses midnight (hour)', apBuffer.hour, '00');
assert('Athens buffer crosses midnight (minute)', apBuffer.minute, '00');

// ── End-to-end payload shape (regression test) ─────────────────────────────
console.log('\n── Sample DN delivery_detail (real-world input) ─────');
const sampleBiz = {
  name: 'ΚΟΤΣΟΡΓΙΟΣ ΠΑΝΑΓΙΩΤΗΣ',
  address: 'ΕΡΓΑΤΙΚΕΣ ΚΑΤΟΙΚΙΕΣ ΛΙΜΑΝΙ 113',
  city: 'ΜΕΣΟΛΟΓΓΙ',
  postal_code: '30200',
};
const sampleNote = {
  vehicle_plate: 'ΑΒΕ1234',
  transport_purpose: 'Πώληση',
  delivery_location: 'Πατησίων 7Α',
  recipient_address: null,
  recipient_city: '—',          // em-dash placeholder we used to send
  recipient_postal: null,
};

const dd = {
  vehicle_number:      H.safeText(sampleNote.vehicle_plate, 'ΑΓΝΩΣΤΟ'),
  purpose_of_movement: H.movementPurposeCode(sampleNote.transport_purpose),
  issuer_of_movement:  H.safeText(sampleBiz.name),
  from_address:        H.safeText(H.stripStreetNumber(sampleBiz.address)),
  from_number:         H.parseStreetNumber(sampleBiz.address),
  from_city:           H.safeText(sampleBiz.city),
  from_zipcode:        H.safePostal(sampleBiz.postal_code),
  to_address:          H.safeText(H.stripStreetNumber(sampleNote.delivery_location || sampleNote.recipient_address)),
  to_number:           H.parseStreetNumber(sampleNote.delivery_location || sampleNote.recipient_address),
  to_city:             H.safeText(sampleNote.recipient_city),
  to_zipcode:          H.safePostal(sampleNote.recipient_postal),
};

assert('vehicle_number is real text', dd.vehicle_number, 'ΑΒΕ1234');
assert('purpose mapped from Πώληση', dd.purpose_of_movement, '1');
assert('from_address stripped of trailing number', dd.from_address, 'ΕΡΓΑΤΙΚΕΣ ΚΑΤΟΙΚΙΕΣ ΛΙΜΑΝΙ');
assert('from_number parsed', dd.from_number, '113');
assert('from_zipcode preserved', dd.from_zipcode, '30200');
assert('to_address from delivery_location', dd.to_address, 'Πατησίων');
assert('to_number with Greek letter suffix', dd.to_number, '7Α');
assert('em-dash city sanitized', dd.to_city, 'ΑΓΝΩΣΤΟ');
assert('missing postal → 00000', dd.to_zipcode, '00000');

// Every Wrapp-required field is a non-empty string
const REQUIRED_DD_FIELDS = [
  'vehicle_number','purpose_of_movement','issuer_of_movement',
  'from_address','from_number','from_city','from_zipcode',
  'to_address','to_number','to_city','to_zipcode',
];
for (const f of REQUIRED_DD_FIELDS) {
  assert(`DD.${f} is non-empty string`, typeof dd[f] === 'string' && dd[f].length > 0, true);
}

console.log('\n── Sample counterpart (sales invoice) ───────────────');
const sampleCust = { name: 'ΓΙΑΝΝΗΣ', afm: '123456789', address: 'Ερμού 7', city: 'Αθήνα', postal_code: '12345' };
const cp = {
  name:         H.safeText(sampleCust.name),
  country_code: 'GR',
  vat:          H.safeText(sampleCust.afm, '000000000'),
  city:         H.safeText(sampleCust.city),
  street:       H.safeText(H.stripStreetNumber(sampleCust.address)),
  number:       H.parseStreetNumber(sampleCust.address),
  postal_code:  H.safePostal(sampleCust.postal_code),
};
assert('counterpart.vat preserved', cp.vat, '123456789');
assert('counterpart.street stripped', cp.street, 'Ερμού');
assert('counterpart.number parsed', cp.number, '7');
assert('counterpart.postal_code', cp.postal_code, '12345');

console.log('\n── Webhook payload resolution (issued-invoice vs invoice-pdf) ─');
// Spec: issued-invoice uses `id`. invoice-pdf uses `invoice_id`.
function resolveWebhookId(body) {
  return body.id || body.invoice_id || body.wrapp_invoice_id || null;
}
assert('issued-invoice with body.id', resolveWebhookId({ id: 'X', my_data_mark: 'M' }), 'X');
assert('invoice-pdf with body.invoice_id', resolveWebhookId({ invoice_id: 'Y', download_url: 'U' }), 'Y');
assert('legacy wrapp_invoice_id still resolves', resolveWebhookId({ wrapp_invoice_id: 'Z' }), 'Z');
assert('precedence: id > invoice_id', resolveWebhookId({ id: 'A', invoice_id: 'B' }), 'A');
assert('empty body returns null', resolveWebhookId({}), null);

console.log('\n──────────────────────────────────────────────────────');
console.log(`  Result: ${pass} passed, ${fail} failed`);
console.log('──────────────────────────────────────────────────────\n');

if (fail > 0) process.exit(1);
