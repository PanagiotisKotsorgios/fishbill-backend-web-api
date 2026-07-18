/**
 * Wrapp STAGING client — always hits the sandbox.
 *
 * This file exists as a completely separate copy from FishBill's production
 * Wrapp integration. The base URL and API key come exclusively from
 * WRAPP_BASE_URL / WRAPP_PARTNER_API_KEY env vars, which point at Wrapp's
 * staging environment. Under NO circumstances should this service call
 * production Wrapp.
 */
const axios  = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

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

async function login(email) {
  const cached = jwtCache.get(email);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.jwt;

  if (!API_KEY) {
    throw new Error('WRAPP_PARTNER_API_KEY not configured');
  }

  const res = await axios.post(`${BASE_URL}/login`, {
    email,
    api_key: API_KEY,
  }, { timeout: 15_000 });

  const jwtStr = res.data?.data?.attributes?.jwt;
  if (!jwtStr) throw new Error('Wrapp login: no JWT in response');

  jwtCache.set(email, { jwt: jwtStr, expiresAt: Date.now() + 23 * 3600 * 1000 });
  return jwtStr;
}

function authHeaders(jwtStr) {
  return { Authorization: `Bearer ${jwtStr}`, Accept: 'application/json' };
}

// ── Public API ──────────────────────────────────────────────────────────────

async function vatSearch(email, vat, countryCode = 'EL') {
  const jwtStr = await login(email);
  const res = await axios.get(`${BASE_URL}/vat_search`, {
    params: { vat, country_code: countryCode },
    headers: authHeaders(jwtStr),
    timeout: 15_000,
  });
  return res.data;
}

async function tenantDetails(email) {
  const jwtStr = await login(email);
  const res = await axios.get(`${BASE_URL}/tenant_details`, {
    headers: authHeaders(jwtStr),
    timeout: 15_000,
  });
  return res.data;
}

async function listBillingBooks(email) {
  const jwtStr = await login(email);
  const res = await axios.get(`${BASE_URL}/billing_books`, {
    headers: authHeaders(jwtStr),
    timeout: 15_000,
  });
  return res.data;
}

async function issueInvoice(email, invoicePayload) {
  const jwtStr = await login(email);
  const res = await axios.post(`${BASE_URL}/invoices`, invoicePayload, {
    headers: { ...authHeaders(jwtStr), 'Content-Type': 'application/json' },
    timeout: 30_000,
  });
  return res.data;
}

async function getInvoiceStatus(email, invoiceId) {
  const jwtStr = await login(email);
  const res = await axios.get(`${BASE_URL}/invoices/${invoiceId}`, {
    headers: authHeaders(jwtStr),
    timeout: 15_000,
  });
  return res.data;
}

async function cancelDeliveryNote(email, invoiceId) {
  const jwtStr = await login(email);
  const res = await axios.delete(`${BASE_URL}/invoices/${invoiceId}/cancel`, {
    headers: authHeaders(jwtStr),
    timeout: 15_000,
  });
  return res.data;
}

async function generatePdf(email, invoiceId, locale = 'el') {
  const jwtStr = await login(email);
  const res = await axios.get(`${BASE_URL}/invoices/${invoiceId}/generate_pdf`, {
    params:  { locale },
    headers: authHeaders(jwtStr),
    timeout: 15_000,
  });
  return res.data;
}

/**
 * Verify a webhook X-Webhook-Secret HMAC-SHA256 header against the raw body,
 * using API_KEY as the shared secret.
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!API_KEY || !signature) return false;
  const expected = crypto
    .createHmac('sha256', API_KEY)
    .update(rawBody, 'utf8')
    .digest('hex');
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
