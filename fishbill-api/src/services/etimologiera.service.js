/**
 * e-timologiera Provider Service — V4 API
 * Provider: BRATNET E.E. — Certified AADE Electronic Invoicing Provider
 * Website:  https://etimologiera.gr
 * Contact:  info@etimologiera.gr | +30 2310 989465
 *
 * Authentication: HTTP Basic Auth (username + API key as password)
 * Dev/Test API:   https://einvoicing-dev-api.etimologiera.gr/v4
 * Production API: https://einvoicing-api.etimologiera.gr/v4
 * Swagger (dev):  https://einvoicing-dev-api.etimologiera.gr/swagger
 *
 * Flow:
 *   1. Build invoice/delivery-note payload (V4 format)
 *   2. POST /sendInvoice  → etimologiera validates, signs & forwards to AADE
 *   3. AADE returns MARK + QR Code via etimologiera response
 *   4. Store MARK on record
 *
 * NOTE: "password" field in platform_settings = API Key from etimologiera dashboard.
 *       Each business has their own account + contract with e-timologiera.
 */

const axios = require('axios');
const pool  = require('../config/database');

const DEV_URL  = process.env.ETIMOLOGIERA_DEV_URL  || 'https://einvoicing-dev-api.etimologiera.gr/v4';
const PROD_URL = process.env.ETIMOLOGIERA_PROD_URL || 'https://einvoicing-api.etimologiera.gr/v4';

// ── Load provider credentials ──────────────────────────────────────────────
// If businessId is provided, try per-business credentials first (business_settings),
// then fall back to platform-level credentials (platform_settings).

async function getCredentials(businessId) {
  // 1. Per-business credentials (stored on the businesses row)
  if (businessId) {
    const [bizRows] = await pool.execute(
      `SELECT etimologiera_username, etimologiera_api_key
       FROM businesses WHERE id = ? LIMIT 1`,
      [businessId]
    );
    const biz = bizRows[0] || {};
    if (biz.etimologiera_username && biz.etimologiera_api_key) {
      // Test mode from platform settings
      const [kvRows] = await pool.execute(
        `SELECT setting_value FROM platform_settings WHERE setting_key = 'provider_test_mode' LIMIT 1`
      );
      const testMode = (kvRows[0]?.setting_value === '1');
      return {
        baseUrl: testMode ? DEV_URL : PROD_URL,
        username: biz.etimologiera_username,
        password: biz.etimologiera_api_key,
        testMode,
        source: 'business',
      };
    }
  }

  // 2. Platform-level credentials (fallback / admin testing)
  const [kvRows] = await pool.execute(
    `SELECT setting_key, setting_value FROM platform_settings
     WHERE setting_key IN ('provider_name','provider_username','provider_password','provider_test_mode')`
  );

  const cfg = {};
  for (const r of kvRows) cfg[r.setting_key] = r.setting_value;

  if (!cfg.provider_username || !cfg.provider_password) {
    throw new Error('e-timologiera credentials not configured. Set username & API key in Admin → Πάροχος or Business Settings.');
  }

  const testMode = cfg.provider_test_mode === '1';
  const baseUrl  = testMode ? DEV_URL : PROD_URL;

  return { baseUrl, username: cfg.provider_username, password: cfg.provider_password, testMode, source: 'platform' };
}

// ── HTTP client factory ────────────────────────────────────────────────────

function makeClient(baseUrl, username, password) {
  return axios.create({
    baseURL: baseUrl,
    timeout: 30000,
    auth: { username, password },
    headers: {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
  });
}

// ── Parse V4 response ─────────────────────────────────────────────────────
// V4 actual shape: { userRequestID, version, response: { responses: [{ invoiceUid, invoiceMark, authenticationCode, invoiceUrl }] } }

function parseResponse(data) {
  // Primary V4 path
  const resp = data?.response?.responses?.[0];
  if (resp) {
    return {
      mark:     resp.invoiceMark         || null,
      uid:      resp.invoiceUid          || null,
      qrUrl:    resp.invoiceUrl          || null,
      authCode: resp.authenticationCode  || null,
      status:   'success',
      errors:   [],
      raw:      data,
    };
  }
  // Legacy / flat fallback (should not happen with V4 but keeps backward compat)
  if (data?.invoice && Array.isArray(data.invoice) && data.invoice.length > 0) {
    const inv = data.invoice[0];
    return {
      mark:     inv.invoiceMark || inv.mark || null,
      uid:      inv.invoiceUid  || inv.uid  || null,
      qrUrl:    inv.invoiceUrl  || inv.qrUrl || null,
      authCode: inv.authenticationCode || null,
      status:   inv.status || 'success',
      errors:   inv.errors || [],
      raw:      data,
    };
  }
  // Minimal flat fallback
  return {
    mark:     data.invoiceMark || data.mark || null,
    uid:      data.invoiceUid  || data.uid  || null,
    qrUrl:    data.invoiceUrl  || data.qrUrl || null,
    authCode: data.authenticationCode || null,
    status:   data.status || 'success',
    errors:   data.errors || [],
    raw:      data,
  };
}

// ── Endpoints ─────────────────────────────────────────────────────────────

/**
 * POST /sendInvoice
 * Submit an invoice or delivery note to e-timologiera for transmission to AADE myDATA.
 *
 * @param {Object} payload — V4-format invoice payload { invoice: [{ ... }] }
 * @returns {Object} { uid, mark, qrUrl, status, testMode, raw }
 */
async function sendInvoice(payload, businessId) {
  const { baseUrl, username, password, testMode } = await getCredentials(businessId);
  const client = makeClient(baseUrl, username, password);

  try {
    const response = await client.post('/sendInvoice', payload);
    const parsed   = parseResponse(response.data);
    return { ...parsed, testMode };
  } catch (err) {
    const body = err.response?.data;
    const msg  = body?.message || body?.error || (Array.isArray(body?.errors) ? body.errors.join(', ') : null) || err.message;
    const code = err.response?.status;
    throw new Error(`e-timologiera sendInvoice failed (HTTP ${code}): ${msg}`);
  }
}

/**
 * Test connectivity — attempts to reach the API with current credentials.
 * @returns {{ ok: boolean, message: string, baseUrl: string, testMode: boolean }}
 */
async function testConnection() {
  try {
    const { baseUrl, username, password, testMode } = await getCredentials();
    const client = makeClient(baseUrl, username, password);
    // Try a minimal POST to /sendInvoice with an empty payload to check auth
    // A 400 (bad request) means we connected successfully; 401 = wrong credentials
    try {
      await client.post('/sendInvoice', { invoice: [] }, { timeout: 10000 });
    } catch (inner) {
      if (inner.response?.status === 401) throw inner;
      // Any non-401 error (400, 422, etc.) means credentials are valid
    }
    return { ok: true, message: `Σύνδεση επιτυχής (${testMode ? 'DEV' : 'PRODUCTION'})`, baseUrl, testMode };
  } catch (err) {
    if (err.response?.status === 401) {
      return { ok: false, message: 'Λανθασμένα credentials (401 Unauthorized)', testMode: false };
    }
    return { ok: false, message: err.message, testMode: false };
  }
}

/**
 * Cancel a transmitted invoice via DELETE /cancelSignature.
 * @param {string} uid — etimologiera invoiceUid returned at transmission
 * @param {string|number} businessId
 */
async function cancelInvoice(uid, businessId) {
  const { baseUrl, username, password, testMode } = await getCredentials(businessId);
  const client = makeClient(baseUrl, username, password);
  try {
    const response = await client.delete(`/cancelSignature/${uid}`);
    return { ok: true, testMode, raw: response.data };
  } catch (err) {
    const body = err.response?.data;
    const msg  = body?.message || body?.error || err.message;
    throw new Error(`e-timologiera cancelInvoice failed (HTTP ${err.response?.status}): ${msg}`);
  }
}

// ── Stub endpoints (V4 does not expose list/status APIs; kept for future use) ─

async function getResources() {
  throw new Error('getResources not available in e-timologiera V4 API.');
}

async function listInvoices() {
  throw new Error('listInvoices not available in e-timologiera V4 API.');
}

async function getInvoiceStatus() {
  throw new Error('getInvoiceStatus not available in e-timologiera V4 API.');
}

module.exports = {
  sendInvoice,
  cancelInvoice,
  testConnection,
  getCredentials,
  getResources,
  listInvoices,
  getInvoiceStatus,
};
