/**
 * Wrapp STAGING client — always hits the sandbox.
 *
 * Every call is persisted to ag_wrapp_logs so the admin panel can inspect
 * request/response bodies, timing, and errors after the fact.
 */
const axios  = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const pool   = require('../config/database');

const BASE_URL = process.env.WRAPP_BASE_URL || 'https://staging.wrapp.ai/api/v1';
const API_KEY  = process.env.WRAPP_PARTNER_API_KEY;

if (!BASE_URL.includes('staging') && !BASE_URL.includes('sandbox')) {
  logger.warn(
    `WARNING: WRAPP_BASE_URL="${BASE_URL}" does not look like a staging URL. ` +
    `Agrotis API is expected to run against Wrapp staging only.`
  );
}

// In-memory JWT cache per tenant (email) — Wrapp JWTs live 24h.
const jwtCache = new Map();

// ── Logging helper ─────────────────────────────────────────────────────────

function truncate(str, max = 20_000) {
  if (str == null) return null;
  const s = typeof str === 'string' ? str : JSON.stringify(str);
  return s.length > max ? s.slice(0, max) + '…[truncated]' : s;
}

/** Log one Wrapp API call to ag_wrapp_logs. Never throws. */
async function persistLog(row) {
  try {
    await pool.execute(
      `INSERT INTO ag_wrapp_logs
         (business_id, event_type, direction, endpoint,
          request_body, response_body, status_code, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        row.business_id || null,
        row.event_type  || 'unknown',
        row.direction   || 'outbound',
        row.endpoint    || null,
        truncate(row.request_body),
        truncate(row.response_body),
        row.status_code || null,
        row.error_message ? String(row.error_message).slice(0, 500) : null,
      ]
    );
  } catch (e) {
    logger.warn(`Failed to persist wrapp log: ${e.message}`);
  }
}

/** Wrap an axios call with logging. Returns response.data or throws. */
async function loggedCall({ eventType, method, path, requestBody, businessId }, doCall) {
  const start = Date.now();
  const endpoint = `${method} ${path}`;
  try {
    const res = await doCall();
    const elapsed = Date.now() - start;
    logger.info(`Wrapp ${endpoint} → ${res.status} (${elapsed}ms)`);
    persistLog({
      business_id:  businessId,
      event_type:   eventType,
      direction:    'outbound',
      endpoint,
      request_body: requestBody,
      response_body: res.data,
      status_code:  res.status,
    });
    return res.data;
  } catch (err) {
    const status  = err.response?.status;
    const body    = err.response?.data;
    const elapsed = Date.now() - start;
    logger.error(`Wrapp ${endpoint} FAILED status=${status} (${elapsed}ms): ${err.message}`);
    persistLog({
      business_id:   businessId,
      event_type:    eventType,
      direction:     'outbound',
      endpoint,
      request_body:  requestBody,
      response_body: body,
      status_code:   status,
      error_message: err.message,
    });
    throw err;
  }
}

// ── Wrapp calls ────────────────────────────────────────────────────────────

async function login(email, businessId = null) {
  const cached = jwtCache.get(email);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.jwt;

  if (!API_KEY) throw new Error('WRAPP_PARTNER_API_KEY not configured');

  const jwtStr = await loggedCall(
    { eventType: 'login', method: 'POST', path: '/login', requestBody: { email }, businessId },
    () => axios.post(`${BASE_URL}/login`, { email, api_key: API_KEY }, { timeout: 15_000 })
  ).then(data => data?.data?.attributes?.jwt);

  if (!jwtStr) throw new Error('Wrapp login: no JWT in response');
  jwtCache.set(email, { jwt: jwtStr, expiresAt: Date.now() + 23 * 3600 * 1000 });
  return jwtStr;
}

function authHeaders(jwtStr) {
  return { Authorization: `Bearer ${jwtStr}`, Accept: 'application/json' };
}

async function vatSearch(email, vat, countryCode = 'EL', businessId = null) {
  const jwtStr = await login(email, businessId);
  return loggedCall(
    { eventType: 'vat_search', method: 'GET', path: '/vat_search', requestBody: { vat, country_code: countryCode }, businessId },
    () => axios.get(`${BASE_URL}/vat_search`, {
      params: { vat, country_code: countryCode },
      headers: authHeaders(jwtStr),
      timeout: 15_000,
    })
  );
}

async function tenantDetails(email, businessId = null) {
  const jwtStr = await login(email, businessId);
  return loggedCall(
    { eventType: 'tenant_details', method: 'GET', path: '/tenant_details', businessId },
    () => axios.get(`${BASE_URL}/tenant_details`, {
      headers: authHeaders(jwtStr), timeout: 15_000,
    })
  );
}

async function listBillingBooks(email, businessId = null) {
  const jwtStr = await login(email, businessId);
  return loggedCall(
    { eventType: 'billing_books', method: 'GET', path: '/billing_books', businessId },
    () => axios.get(`${BASE_URL}/billing_books`, {
      headers: authHeaders(jwtStr), timeout: 15_000,
    })
  );
}

async function issueInvoice(email, invoicePayload, businessId = null) {
  const jwtStr = await login(email, businessId);
  return loggedCall(
    { eventType: 'issue_invoice', method: 'POST', path: '/invoices', requestBody: invoicePayload, businessId },
    () => axios.post(`${BASE_URL}/invoices`, invoicePayload, {
      headers: { ...authHeaders(jwtStr), 'Content-Type': 'application/json' },
      timeout: 30_000,
    })
  );
}

async function getInvoiceStatus(email, invoiceId, businessId = null) {
  const jwtStr = await login(email, businessId);
  return loggedCall(
    { eventType: 'invoice_status', method: 'GET', path: `/invoices/${invoiceId}`, businessId },
    () => axios.get(`${BASE_URL}/invoices/${invoiceId}`, {
      headers: authHeaders(jwtStr), timeout: 15_000,
    })
  );
}

async function cancelDeliveryNote(email, invoiceId, businessId = null) {
  const jwtStr = await login(email, businessId);
  return loggedCall(
    { eventType: 'cancel_delivery_note', method: 'DELETE', path: `/invoices/${invoiceId}/cancel`, businessId },
    () => axios.delete(`${BASE_URL}/invoices/${invoiceId}/cancel`, {
      headers: authHeaders(jwtStr), timeout: 15_000,
    })
  );
}

async function generatePdf(email, invoiceId, locale = 'el', businessId = null) {
  const jwtStr = await login(email, businessId);
  return loggedCall(
    { eventType: 'generate_pdf', method: 'GET', path: `/invoices/${invoiceId}/generate_pdf`, requestBody: { locale }, businessId },
    () => axios.get(`${BASE_URL}/invoices/${invoiceId}/generate_pdf`, {
      params:  { locale },
      headers: authHeaders(jwtStr),
      timeout: 15_000,
    })
  );
}

/** Verify a webhook X-Webhook-Secret HMAC-SHA256 header against the raw body. */
function verifyWebhookSignature(rawBody, signature) {
  if (!API_KEY || !signature) return false;
  const expected = crypto.createHmac('sha256', API_KEY).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  login,
  vatSearch,
  tenantDetails,
  listBillingBooks,
  issueInvoice,
  getInvoiceStatus,
  cancelDeliveryNote,
  generatePdf,
  verifyWebhookSignature,
  __baseUrl: BASE_URL,
};
