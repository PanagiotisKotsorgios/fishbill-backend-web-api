/**
 * Integrations routes  — /api/integrations/*
 *
 * Covers:
 *   EMAIL   — Brevo, SendGrid, Mailgun, SMTP
 *   SMS     — Infobip, Apifon, Routee, Vonage, Twilio, BSMS, Yuboto
 *   myDATA PROVIDERS — SoftOne, EpsilonNet, UniDoc, Entersoft, direct ΑΑΔΕ
 *   WEBHOOKS — register/list/delete business webhooks
 *   LOGS    — query integration logs
 *
 * POST /api/integrations/email/test        → send test email
 * POST /api/integrations/sms/test          → send test SMS
 * POST /api/integrations/provider/test     → test myDATA provider connection
 * POST /api/integrations/provider/transmit → transmit invoice to provider
 * GET  /api/integrations/logs              → list integration logs
 * GET  /api/integrations/webhooks          → list webhooks
 * POST /api/integrations/webhooks          → create webhook
 * DELETE /api/integrations/webhooks/:id    → delete webhook
 */

const express    = require('express');
const router     = express.Router();
const https      = require('https');
const http       = require('http');
const pool       = require('../config/database');
const { authenticate } = require('../middleware/auth');
const invoiceSvc = require('../services/invoice.service');

router.use(authenticate);

// ─── helpers ────────────────────────────────────────────────────────────────

function getBizId(req) {
  return (req.user.role === 'super_admin' && req.query.business_id)
    ? req.query.business_id
    : req.user.business_id;
}

async function getBusinessSettings(bizId) {
  const [biz]  = await pool.execute('SELECT * FROM businesses WHERE id = ? LIMIT 1', [bizId]);
  const [sets] = await pool.execute('SELECT * FROM business_settings WHERE business_id = ? LIMIT 1', [bizId]);
  return { biz: biz[0] || {}, settings: sets[0] || {} };
}

async function logIntegration(bizId, service, eventType, status, requestRef, recipient, errorMsg, meta) {
  try {
    await pool.execute(
      `INSERT INTO integration_logs
       (business_id, service, event_type, status, request_ref, recipient, error_msg, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [bizId || null, service, eventType, status, requestRef || null, recipient || null, errorMsg || null, meta ? JSON.stringify(meta) : null]
    );
  } catch (e) { console.error('[IntegrationLog]', e.message); }
}

/** Simple HTTPS POST helper (no external deps). Returns { ok, status, body } */
function httpPost(urlStr, headers, body) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers },
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ ok: res.statusCode < 300, status: res.statusCode, body: data }));
    });
    req.on('error', (e) => resolve({ ok: false, status: 0, body: e.message }));
    req.setTimeout(12000, () => { req.destroy(); resolve({ ok: false, status: 0, body: 'timeout' }); });
    req.write(bodyStr);
    req.end();
  });
}

function httpGet(urlStr, headers) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: { ...headers },
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ ok: res.statusCode < 300, status: res.statusCode, body: data }));
    });
    req.on('error', (e) => resolve({ ok: false, status: 0, body: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, status: 0, body: 'timeout' }); });
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send transactional email via configured provider.
 * Supports: brevo, sendgrid, mailgun, smtp (via external nodemailer if installed)
 */
async function sendEmail(bizSettings, to, subject, htmlContent, textContent) {
  const provider = bizSettings.email_provider || 'smtp';

  if (provider === 'brevo') {
    // ── Brevo (ex-Sendinblue) ────────────────────────────────────────────────
    const apiKey = bizSettings.brevo_api_key;
    if (!apiKey) throw new Error('Brevo API key not configured.');

    const payload = {
      sender: {
        email: bizSettings.brevo_sender_email || bizSettings.smtp_from_email || 'noreply@fishbill.gr',
        name: bizSettings.brevo_sender_name || bizSettings.smtp_from_name || 'FishBill',
      },
      to: [{ email: to }],
      subject,
      htmlContent: htmlContent || textContent,
    };

    const r = await httpPost('https://api.brevo.com/v3/smtp/email', { 'api-key': apiKey }, payload);
    if (!r.ok) throw new Error(`Brevo error ${r.status}: ${r.body}`);
    const resp = JSON.parse(r.body);
    return { provider: 'brevo', messageId: resp.messageId };

  } else if (provider === 'sendgrid') {
    // ── SendGrid ──────────────────────────────────────────────────────────────
    const apiKey = bizSettings.sendgrid_api_key;
    if (!apiKey) throw new Error('SendGrid API key not configured.');

    const payload = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: bizSettings.smtp_from_email || 'noreply@fishbill.gr', name: bizSettings.smtp_from_name || 'FishBill' },
      subject,
      content: [{ type: 'text/html', value: htmlContent || textContent }],
    };

    const r = await httpPost('https://api.sendgrid.com/v3/mail/send',
      { Authorization: `Bearer ${apiKey}` }, payload);
    if (!r.ok) throw new Error(`SendGrid error ${r.status}: ${r.body}`);
    return { provider: 'sendgrid', messageId: r.status === 202 ? 'queued' : 'unknown' };

  } else if (provider === 'mailgun') {
    // ── Mailgun ───────────────────────────────────────────────────────────────
    const apiKey = bizSettings.mailgun_api_key;
    const domain = bizSettings.mailgun_domain;
    if (!apiKey || !domain) throw new Error('Mailgun API key and domain required.');

    // Mailgun uses form-encoded POST
    const formBody = new URLSearchParams({
      from: `${bizSettings.smtp_from_name || 'FishBill'} <noreply@${domain}>`,
      to,
      subject,
      html: htmlContent || textContent,
    }).toString();

    const credentials = Buffer.from(`api:${apiKey}`).toString('base64');
    const url = new URL(`https://api.mailgun.net/v3/${domain}/messages`);
    const r = await new Promise((resolve) => {
      const opts = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(formBody),
        },
      };
      const req = https.request(opts, (res) => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ ok: res.statusCode < 300, status: res.statusCode, body: d }));
      });
      req.on('error', e => resolve({ ok: false, status: 0, body: e.message }));
      req.write(formBody); req.end();
    });
    if (!r.ok) throw new Error(`Mailgun error ${r.status}: ${r.body}`);
    const resp = JSON.parse(r.body);
    return { provider: 'mailgun', messageId: resp.id };

  } else {
    // ── SMTP (nodemailer if available, otherwise reject) ─────────────────────
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: bizSettings.smtp_host,
        port: parseInt(bizSettings.smtp_port) || 587,
        secure: !!bizSettings.smtp_secure,
        auth: { user: bizSettings.smtp_user, pass: bizSettings.smtp_pass },
      });
      const info = await transporter.sendMail({
        from: `"${bizSettings.smtp_from_name || 'FishBill'}" <${bizSettings.smtp_from_email}>`,
        to, subject,
        html: htmlContent,
        text: textContent,
      });
      return { provider: 'smtp', messageId: info.messageId };
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND') throw new Error('SMTP requires nodemailer. Run: npm install nodemailer');
      throw e;
    }
  }
}

// POST /api/integrations/email/test
router.post('/email/test', async (req, res, next) => {
  try {
    const bizId = getBizId(req);
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'Απαιτείται email παραλήπτη.' });

    const { settings } = await getBusinessSettings(bizId);

    const result = await sendEmail(
      settings,
      to,
      '✅ FishBill — Δοκιμαστικό Email',
      `<h2>Η σύνδεση email λειτουργεί!</h2><p>Αυτό είναι ένα δοκιμαστικό email από το FishBill.</p><p><small>Provider: ${settings.email_provider || 'smtp'}</small></p>`
    );

    await logIntegration(bizId, settings.email_provider || 'smtp', 'email_sent', 'success', result.messageId, to, null, { test: true });
    res.json({ data: { ok: true, ...result } });
  } catch (err) {
    await logIntegration(getBizId(req), 'email', 'email_sent', 'failed', null, req.body.to, err.message, { test: true });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SMS
// ═══════════════════════════════════════════════════════════════════════════

async function sendSms(bizSettings, to, text) {
  const provider = bizSettings.sms_provider_type || bizSettings.sms_provider || 'infobip';

  if (provider === 'infobip') {
    // ── Infobip ──────────────────────────────────────────────────────────────
    const apiKey  = bizSettings.infobip_api_key || bizSettings.sms_api_key;
    const baseUrl = bizSettings.infobip_base_url;
    if (!apiKey || !baseUrl) throw new Error('Infobip API key και base URL απαιτούνται.');

    const payload = {
      messages: [{
        from: bizSettings.sms_from || 'FishBill',
        destinations: [{ to }],
        text,
      }],
    };

    const r = await httpPost(`https://${baseUrl}/sms/2/text/advanced`,
      { Authorization: `App ${apiKey}`, Accept: 'application/json' }, payload);
    if (!r.ok) throw new Error(`Infobip error ${r.status}: ${r.body}`);
    const resp = JSON.parse(r.body);
    const msgId = resp.messages?.[0]?.messageId;
    return { provider: 'infobip', messageId: msgId };

  } else if (provider === 'apifon') {
    // ── Apifon (Greek provider) ───────────────────────────────────────────────
    const apiKey = bizSettings.apifon_api_key || bizSettings.sms_api_key;
    if (!apiKey) throw new Error('Apifon API key απαιτείται.');

    const payload = {
      apikey: apiKey,
      senderid: bizSettings.apifon_sender || 'FishBill',
      sms: [{ to, message: text }],
    };

    const r = await httpPost('https://api.apifon.com/sms/send', {}, payload);
    if (!r.ok) throw new Error(`Apifon error ${r.status}: ${r.body}`);
    return { provider: 'apifon', messageId: JSON.parse(r.body)?.sms?.[0]?.msgId };

  } else if (provider === 'routee') {
    // ── Routee (by OTE/COSMOTE subsidiary) ───────────────────────────────────
    const apiKey = bizSettings.routee_api_key || bizSettings.sms_api_key;
    if (!apiKey) throw new Error('Routee API key απαιτείται.');

    // Routee uses OAuth2 first, then send
    const tokenR = await httpPost('https://auth.routee.net/oauth/token',
      { Authorization: `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded' },
      'grant_type=client_credentials');
    if (!tokenR.ok) throw new Error(`Routee auth error: ${tokenR.body}`);
    const token = JSON.parse(tokenR.body).access_token;

    const payload = {
      body: text,
      to,
      from: bizSettings.routee_sender_id || 'FishBill',
    };
    const r = await httpPost('https://connect.routee.net/sms', { Authorization: `Bearer ${token}` }, payload);
    if (!r.ok) throw new Error(`Routee SMS error ${r.status}: ${r.body}`);
    return { provider: 'routee', messageId: JSON.parse(r.body)?.trackingId };

  } else if (provider === 'vonage') {
    // ── Vonage (Nexmo) ───────────────────────────────────────────────────────
    const apiKey    = bizSettings.vonage_api_key || bizSettings.sms_api_key;
    const apiSecret = bizSettings.vonage_api_secret || bizSettings.sms_api_secret;
    if (!apiKey || !apiSecret) throw new Error('Vonage API key και secret απαιτούνται.');

    const payload = {
      api_key: apiKey,
      api_secret: apiSecret,
      from: bizSettings.sms_from || 'FishBill',
      to,
      text,
    };

    const r = await httpPost('https://rest.nexmo.com/sms/json', {}, payload);
    if (!r.ok) throw new Error(`Vonage error ${r.status}: ${r.body}`);
    const resp = JSON.parse(r.body);
    const msg = resp.messages?.[0];
    if (msg?.status !== '0') throw new Error(`Vonage: ${msg?.['error-text']}`);
    return { provider: 'vonage', messageId: msg['message-id'] };

  } else if (provider === 'twilio') {
    // ── Twilio ────────────────────────────────────────────────────────────────
    const sid   = bizSettings.twilio_account_sid;
    const token = bizSettings.twilio_auth_token;
    const from  = bizSettings.twilio_from_number;
    if (!sid || !token || !from) throw new Error('Twilio Account SID, Auth Token και αριθμός απαιτούνται.');

    const formBody = new URLSearchParams({ To: to, From: from, Body: text }).toString();
    const creds = Buffer.from(`${sid}:${token}`).toString('base64');

    const r = await new Promise((resolve) => {
      const opts = {
        hostname: 'api.twilio.com',
        path: `/2010-04-01/Accounts/${sid}/Messages.json`,
        method: 'POST',
        headers: {
          Authorization: `Basic ${creds}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(formBody),
        },
      };
      const req = https.request(opts, (res) => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ ok: res.statusCode < 300, status: res.statusCode, body: d }));
      });
      req.on('error', e => resolve({ ok: false, status: 0, body: e.message }));
      req.write(formBody); req.end();
    });
    if (!r.ok) throw new Error(`Twilio error ${r.status}: ${r.body}`);
    return { provider: 'twilio', messageId: JSON.parse(r.body).sid };

  } else if (provider === 'bsms') {
    // ── BSMS (bsms.gr - Greek provider) ──────────────────────────────────────
    const apiKey = bizSettings.bsms_api_key || bizSettings.sms_api_key;
    if (!apiKey) throw new Error('BSMS API key απαιτείται.');

    const r = await httpPost('https://www.bsms.gr/api/sms', { 'X-API-Key': apiKey }, {
      sender: bizSettings.sms_from || 'FishBill',
      recipients: [to],
      message: text,
    });
    if (!r.ok) throw new Error(`BSMS error ${r.status}: ${r.body}`);
    return { provider: 'bsms', messageId: JSON.parse(r.body)?.id };

  } else if (provider === 'yuboto') {
    // ── Yuboto (Greek provider) ───────────────────────────────────────────────
    const apiKey = bizSettings.yuboto_api_key || bizSettings.sms_api_key;
    if (!apiKey) throw new Error('Yuboto API key απαιτείται.');

    const r = await httpPost('https://services.yuboto.com/web2sms/api/v2/smsc.aspx',
      { Authorization: `Bearer ${apiKey}` }, {
        sender: bizSettings.sms_from || 'FishBill',
        recipient: to,
        message: text,
      });
    if (!r.ok) throw new Error(`Yuboto error ${r.status}: ${r.body}`);
    return { provider: 'yuboto', messageId: JSON.parse(r.body)?.msgid };

  } else {
    throw new Error(`Άγνωστος SMS πάροχος: ${provider}`);
  }
}

// POST /api/integrations/sms/test
router.post('/sms/test', async (req, res, next) => {
  try {
    const bizId = getBizId(req);
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'Απαιτείται αριθμός τηλεφώνου.' });

    const { settings } = await getBusinessSettings(bizId);
    const result = await sendSms(settings, to, 'FishBill: Δοκιμαστικό SMS — η σύνδεση λειτουργεί!');

    await logIntegration(bizId, settings.sms_provider_type || 'infobip', 'sms_sent', 'success', result.messageId, to, null, { test: true });
    res.json({ data: { ok: true, ...result } });
  } catch (err) {
    await logIntegration(getBizId(req), 'sms', 'sms_sent', 'failed', null, req.body.to, err.message, { test: true });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// myDATA PROVIDERS (SoftOne, EpsilonNet, UniDoc, direct)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Transmit invoice XML to chosen myDATA provider.
 * The provider calls ΑΑΔΕ on behalf of the business and returns MARK.
 *
 * NOTE: Each provider has different API — the actual XML format is standard
 * ΑΑΔΕ myDATA 1.0.6. The provider just relays it and returns MARK + UID.
 */
async function transmitToProvider(biz, invoiceXml) {
  const provider = biz.mydata_provider || 'direct';

  if (provider === 'softone') {
    // ── SoftOne (Unisoft SA) ──────────────────────────────────────────────────
    // Docs: https://www.softone.gr/developer/mydata
    const apiKey  = biz.softone_api_key;
    const apiUrl  = biz.softone_api_url || 'https://api.softone.gr/api/mydata';
    const username = biz.softone_username;
    const password = biz.softone_password;
    const companyId = biz.softone_company_id;

    if (!apiKey) throw new Error('SoftOne API key δεν έχει ρυθμιστεί.');

    // SoftOne: POST JSON with base64 XML
    const payload = {
      apiKey,
      username,
      password,
      companyId,
      invoiceXml: Buffer.from(invoiceXml).toString('base64'),
    };

    const r = await httpPost(`${apiUrl}/SendInvoices`, { 'Content-Type': 'application/json' }, payload);
    if (!r.ok) throw new Error(`SoftOne error ${r.status}: ${r.body}`);
    const resp = JSON.parse(r.body);
    return {
      provider: 'softone',
      mark: resp.mark || resp.MARK,
      uid:  resp.uid  || resp.UID,
      raw:  resp,
    };

  } else if (provider === 'epsilonnet') {
    // ── Epsilon Net ───────────────────────────────────────────────────────────
    // Docs: https://mydata.epsilonnet.gr/
    const apiKey  = biz.epsilonnet_api_key;
    const apiUrl  = biz.epsilonnet_api_url || 'https://mydata.epsilonnet.gr/api';
    const username = biz.epsilonnet_username;
    const password = biz.epsilonnet_password;

    if (!apiKey) throw new Error('Epsilon Net API key δεν έχει ρυθμιστεί.');

    // First authenticate to get token
    const authR = await httpPost(`${apiUrl}/auth/login`, {},
      { username, password, apiKey });
    if (!authR.ok) throw new Error(`EpsilonNet auth error: ${authR.body}`);
    const authData = JSON.parse(authR.body);
    const token = authData.token || authData.access_token;

    // Then send invoice
    const r = await httpPost(`${apiUrl}/invoices/transmit`,
      { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      { invoiceXml, format: 'xml' });
    if (!r.ok) throw new Error(`EpsilonNet transmit error ${r.status}: ${r.body}`);
    const resp = JSON.parse(r.body);
    return {
      provider: 'epsilonnet',
      mark: resp.mark || resp.MARK,
      uid:  resp.uid  || resp.UID,
      raw:  resp,
    };

  } else if (provider === 'unidoc') {
    // ── UniDoc (Atlantis ERP) ─────────────────────────────────────────────────
    // Docs: https://www.unidoc.gr/api
    const apiKey  = biz.unidoc_api_key;
    const apiUrl  = biz.unidoc_api_url || 'https://api.unidoc.gr/v1';
    const username = biz.unidoc_username;
    const password = biz.unidoc_password;

    if (!apiKey) throw new Error('UniDoc API key δεν έχει ρυθμιστεί.');

    const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    const r = await httpPost(`${apiUrl}/mydata/send`,
      { Authorization: authHeader, 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      { invoiceData: invoiceXml, afm: biz.afm });
    if (!r.ok) throw new Error(`UniDoc error ${r.status}: ${r.body}`);
    const resp = JSON.parse(r.body);
    return {
      provider: 'unidoc',
      mark: resp.mark,
      uid:  resp.uid,
      raw:  resp,
    };

  } else {
    // ── Direct ΑΑΔΕ (no intermediary provider) ────────────────────────────────
    // Uses business's own myDATA credentials directly
    const userId = biz.mydata_user_id;
    const subKey = biz.mydata_subscription_key;

    if (!userId || !subKey) {
      throw new Error('myDATA User ID και Subscription Key απαιτούνται για άμεση σύνδεση.');
    }

    const apiBase = process.env.MYDATA_API_URL ||
      'https://mydataapidev.aade.gr';  // production: https://mydatapi.aade.gr/myDATA

    const r = await httpPost(`${apiBase}/SendInvoices`,
      {
        'aade-user-id': userId,
        'Ocp-Apim-Subscription-Key': subKey,
        'Content-Type': 'text/xml',
      },
      invoiceXml);

    if (!r.ok) throw new Error(`ΑΑΔΕ myDATA error ${r.status}: ${r.body}`);

    // Parse MARK from XML response
    const markMatch = r.body.match(/<mark>(\d+)<\/mark>/i);
    const uidMatch  = r.body.match(/<uid>([^<]+)<\/uid>/i);
    return {
      provider: 'direct',
      mark: markMatch?.[1],
      uid:  uidMatch?.[1],
      raw:  r.body,
    };
  }
}

// POST /api/integrations/provider/test
router.post('/provider/test', async (req, res, next) => {
  try {
    const bizId = getBizId(req);
    const [bizRows] = await pool.execute('SELECT * FROM businesses WHERE id = ? LIMIT 1', [bizId]);
    if (!bizRows.length) return res.status(404).json({ error: 'Business not found.' });
    const biz = bizRows[0];
    const provider = biz.mydata_provider || 'direct';

    // Do a lightweight test (balance/account check, not actual transmission)
    let testResult = {};

    if (provider === 'softone') {
      if (!biz.softone_api_key) return res.status(400).json({ error: 'SoftOne API key δεν έχει ρυθμιστεί.' });
      const r = await httpPost(`${biz.softone_api_url || 'https://api.softone.gr/api/mydata'}/Test`,
        {}, { apiKey: biz.softone_api_key });
      testResult = { ok: r.ok, status: r.status, provider };

    } else if (provider === 'epsilonnet') {
      if (!biz.epsilonnet_api_key) return res.status(400).json({ error: 'Epsilon Net API key δεν έχει ρυθμιστεί.' });
      testResult = { ok: true, provider, note: 'Τα credentials αποθηκεύτηκαν. Δοκιμή κατά τη μετάδοση.' };

    } else if (provider === 'unidoc') {
      if (!biz.unidoc_api_key) return res.status(400).json({ error: 'UniDoc API key δεν έχει ρυθμιστεί.' });
      testResult = { ok: true, provider, note: 'Τα credentials αποθηκεύτηκαν. Δοκιμή κατά τη μετάδοση.' };

    } else {
      // direct — check myDATA credentials are set
      if (!biz.mydata_user_id || !biz.mydata_subscription_key) {
        return res.status(400).json({ error: 'myDATA User ID και Subscription Key δεν έχουν ρυθμιστεί.' });
      }
      testResult = { ok: true, provider: 'direct', note: 'Credentials ρυθμισμένα. Δοκιμή κατά τη μετάδοση παραστατικού.' };
    }

    await logIntegration(bizId, provider, 'test_connection', testResult.ok ? 'success' : 'failed', null, null, null, testResult);
    res.json({ data: testResult });
  } catch (err) { next(err); }
});

// POST /api/integrations/provider/transmit
// Body: { invoice_id }  — transmits invoice via the platform provider (e-timologiera only)
router.post('/provider/transmit', async (req, res, next) => {
  try {
    const bizId = getBizId(req);
    const { invoice_id } = req.body;
    if (!invoice_id) return res.status(400).json({ error: 'invoice_id απαιτείται.' });

    const [invRows] = await pool.execute(
      `SELECT i.* FROM invoices i WHERE i.id = ? AND i.business_id = ? LIMIT 1`,
      [invoice_id, bizId]
    );
    if (!invRows.length) return res.status(404).json({ error: 'Invoice not found.' });

    // Delegate entirely to invoice.service.transmit() which handles provider routing
    const result = await invoiceSvc.transmit(invRows[0]);

    if (!result.success) {
      await logIntegration(bizId, 'etimologiera', 'invoice_transmitted', 'failed', null, null, result.message, { invoice_id });
      return res.status(422).json({ error: result.message });
    }

    await logIntegration(bizId, 'etimologiera', 'invoice_transmitted', 'success', result.mark, null, null, { invoice_id, mark: result.mark });
    res.json({ data: { ok: true, mark: result.mark, uid: result.uid, qrUrl: result.qrUrl } });
  } catch (err) {
    await logIntegration(getBizId(req), 'etimologiera', 'invoice_transmitted', 'failed', null, null, err.message, { invoice_id: req.body.invoice_id });
    next(err);
  }
});

// POST /api/integrations/retry-failed  — re-transmit all failed/unsubmitted invoices
router.post('/retry-failed', async (req, res, next) => {
  try {
    const bizId = getBizId(req);

    const [failedInvs] = await pool.execute(
      "SELECT id FROM invoices WHERE business_id = ? AND status IN ('failed','issued') AND mydata_mark IS NULL LIMIT 50",
      [bizId]
    );

    let successCount = 0, failCount = 0;
    for (const row of failedInvs) {
      try {
        const [invRows] = await pool.execute('SELECT * FROM invoices WHERE id = ? LIMIT 1', [row.id]);
        if (!invRows.length) continue;
        const result = await invoiceSvc.transmit(invRows[0]);
        if (result.success) successCount++;
        else failCount++;
      } catch(e) {
        failCount++;
      }
    }

    res.json({ data: { count: failedInvs.length, success: successCount, failed: failCount } });
  } catch (err) { next(err); }
});

/**
 * Build full myDATA v1.0.6 XML for a given invoice.
 * @param {object} inv   - invoice row from DB
 * @param {object} biz   - business row from DB
 * @param {Array}  lines - invoice_lines rows from DB
 */
function buildMyDataXml(inv, biz, lines = []) {
  // ── Helpers ──────────────────────────────────────────────────────────────
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const num = (v, d = 2) => parseFloat(v || 0).toFixed(d);

  // myDATA VAT category codes
  // 1=24%, 2=13%, 3=6%, 4=17%, 5=9%, 6=4%, 7=0% (law exempt), 8=0% (article exempt)
  function vatCategoryCode(rate) {
    const r = parseFloat(rate || 0);
    if (r >= 24) return 1; // 24%
    if (r >= 13) return 2; // 13%
    if (r >= 9)  return 5; // 9% island reduced
    if (r >= 6)  return 3; // 6%
    return 8;              // 0% exempt
  }

  // myDATA payment method type codes
  function paymentTypeCode(method) {
    switch ((method || '').toLowerCase()) {
      case 'check':          return 2;
      case 'cash':           return 3;
      case 'bank_transfer':  return 4;
      case 'on_credit':      return 5;
      case 'iris':           return 6;
      case 'card':
      case 'credit_card':    return 7;
      default:               return 3; // fallback: cash
    }
  }

  const issueDate = (inv.issue_date || '').toString().slice(0, 10);
  const invoiceType = inv.invoice_type || '1.1';

  // ── If no lines in DB, synthesise one from invoice totals ────────────────
  if (!lines || lines.length === 0) {
    lines = [{
      description: inv.notes || 'Αλιεύματα',
      quantity: 1,
      unit_price: parseFloat(inv.net_value || inv.total_value || 0),
      vat_rate: parseFloat(inv.vat_rate || 13),
      net_value: parseFloat(inv.net_value || 0),
      vat_amount: parseFloat(inv.vat_amount || 0),
      total_value: parseFloat(inv.total_value || 0),
      income_classification_category: 'category1_1',
      income_classification_type: 'E3_561_001',
      income_category: 'E3_561_001',
    }];
  }

  // ── Recalculate summary from lines ───────────────────────────────────────
  let totalNet = 0, totalVat = 0, totalGross = 0;
  lines.forEach(l => {
    totalNet   += parseFloat(l.net_value   || 0);
    totalVat   += parseFloat(l.vat_amount  || 0);
    totalGross += parseFloat(l.total_value || 0);
  });

  // ── invoiceDetails (one <invoiceDetails> per line) ───────────────────────
  const detailsXml = lines.map((l, idx) => {
    const lineNum   = idx + 1;
    const netVal    = parseFloat(l.net_value  || 0);
    const vatAmt    = parseFloat(l.vat_amount || 0);
    const totVal    = parseFloat(l.total_value || (netVal + vatAmt));
    const vatCat    = vatCategoryCode(l.vat_rate);
    const vatRate   = parseFloat(l.vat_rate || 0);
    // Support both original column names and migration 007 names
    const icCat  = l.income_classification_category || 'category1_1';
    const icType = l.income_classification_type || l.income_category || 'E3_561_001';

    return `    <invoiceDetails>
      <lineNumber>${lineNum}</lineNumber>
      <netValue>${num(netVal)}</netValue>
      <vatCategory>${vatCat}</vatCategory>
      <vatAmount>${num(vatAmt)}</vatAmount>
      <vatExemptionCategory/>
      <discountOption>false</discountOption>
      <withheldAmount>0.00</withheldAmount>
      <withheldPercentCategory/>
      <stampDutyAmount>0.00</stampDutyAmount>
      <stampDutyPercentCategory/>
      <feesAmount>0.00</feesAmount>
      <feesPercentCategory/>
      <otherTaxesPercentCategory/>
      <otherTaxesAmount>0.00</otherTaxesAmount>
      <deductionsAmount>0.00</deductionsAmount>
      <lineComments>${esc(l.description || '')}</lineComments>
      <incomeClassification>
        <icls:classificationType>${esc(icType)}</icls:classificationType>
        <icls:classificationCategory>${esc(icCat)}</icls:classificationCategory>
        <icls:amount>${num(netVal)}</icls:amount>
      </incomeClassification>
    </invoiceDetails>`;
  }).join('\n');

  // ── Counterpart (customer) — required for B2B (invoice types 1.x, 2.x) ──
  let counterpartXml = '';
  const b2bTypes = ['1.1','1.2','1.3','1.4','1.5','1.6','2.1','2.2','2.3','2.4'];
  if (b2bTypes.includes(invoiceType) && inv.customer_afm) {
    counterpartXml = `    <counterpart>
      <vatNumber>${esc(inv.customer_afm)}</vatNumber>
      <country>${esc(inv.customer_country || 'GR')}</country>
      <branch>0</branch>
      <name>${esc(inv.customer_name || '')}</name>
    </counterpart>`;
  }

  // ── Payment method ────────────────────────────────────────────────────────
  const pmType   = paymentTypeCode(inv.payment_method);
  const pmAmount = num(inv.total_value || totalGross);

  return `<?xml version="1.0" encoding="UTF-8"?>
<InvoicesDoc xmlns="https://www.aade.gr/myDATA/invoice/v1.0"
             xmlns:icls="https://www.aade.gr/myDATA/incomeClassification/v1.0"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <invoice>
    <issuer>
      <vatNumber>${esc(biz.afm)}</vatNumber>
      <country>GR</country>
      <branch>${parseInt(biz.branch || 0)}</branch>
    </issuer>
${counterpartXml ? counterpartXml + '\n' : ''}    <invoiceHeader>
      <series>${esc(inv.series || 'A')}</series>
      <aa>${esc(inv.number || '')}</aa>
      <issueDate>${issueDate}</issueDate>
      <invoiceType>${esc(invoiceType)}</invoiceType>
      <vatreferenceNumber/>
      <currency>EUR</currency>
    </invoiceHeader>
    <paymentMethods>
      <paymentMethodDetails>
        <type>${pmType}</type>
        <amount>${pmAmount}</amount>
      </paymentMethodDetails>
    </paymentMethods>
${detailsXml}
    <invoiceSummary>
      <totalNetValue>${num(totalNet)}</totalNetValue>
      <totalVatAmount>${num(totalVat)}</totalVatAmount>
      <totalWithheldAmount>0.00</totalWithheldAmount>
      <totalFeesAmount>0.00</totalFeesAmount>
      <totalStampDutyAmount>0.00</totalStampDutyAmount>
      <totalOtherTaxesAmount>0.00</totalOtherTaxesAmount>
      <totalDeductionsAmount>0.00</totalDeductionsAmount>
      <totalGrossValue>${num(totalGross)}</totalGrossValue>
      <incomeClassification>
        <icls:classificationType>E3_561_001</icls:classificationType>
        <icls:classificationCategory>category1_1</icls:classificationCategory>
        <icls:amount>${num(totalNet)}</icls:amount>
      </incomeClassification>
    </invoiceSummary>
  </invoice>
</InvoicesDoc>`.trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION LOGS
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/integrations/logs
router.get('/logs', async (req, res, next) => {
  try {
    const bizId = getBizId(req);
    const { service, status, page = 1, limit = 30 } = req.query;
    const off = (parseInt(page) - 1) * parseInt(limit);

    const where = ['1=1'];
    const params = [];

    if (req.user.role !== 'super_admin') { where.push('business_id = ?'); params.push(bizId); }
    else if (bizId) { where.push('business_id = ?'); params.push(bizId); }

    if (service) { where.push('service = ?'); params.push(service); }
    if (status)  { where.push('status = ?');  params.push(status); }

    const whereStr = where.join(' AND ');
    const [rows] = await pool.execute(
      `SELECT * FROM integration_logs WHERE ${whereStr} ORDER BY created_at DESC LIMIT ${parseInt(limit)} OFFSET ${off}`,
      params
    );
    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM integration_logs WHERE ${whereStr}`,
      params
    );

    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOKS
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/integrations/webhooks
router.get('/webhooks', async (req, res, next) => {
  try {
    const bizId = getBizId(req);
    const [rows] = await pool.execute(
      'SELECT * FROM webhooks WHERE business_id = ? ORDER BY created_at DESC',
      [bizId]
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// POST /api/integrations/webhooks
router.post('/webhooks', async (req, res, next) => {
  try {
    const bizId = getBizId(req);
    const { name, url, secret, events } = req.body;

    if (!name || !url || !events?.length) {
      return res.status(400).json({ error: 'name, url και events απαιτούνται.' });
    }

    try { new URL(url); } catch { return res.status(400).json({ error: 'Μη έγκυρο URL.' }); }

    const refCode = 'WH-' + Date.now().toString(36).toUpperCase();
    await pool.execute(
      `INSERT INTO webhooks (business_id, name, url, secret, events)
       VALUES (?, ?, ?, ?, ?)`,
      [bizId, name, url, secret || null, JSON.stringify(events)]
    );

    const [rows] = await pool.execute(
      'SELECT * FROM webhooks WHERE business_id = ? ORDER BY created_at DESC LIMIT 1',
      [bizId]
    );

    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/integrations/webhooks/:id
router.delete('/webhooks/:id', async (req, res, next) => {
  try {
    const bizId = getBizId(req);
    await pool.execute('DELETE FROM webhooks WHERE id = ? AND business_id = ?', [req.params.id, bizId]);
    res.json({ data: { ok: true } });
  } catch (err) { next(err); }
});

// ── Helper: fire webhooks for an event (call from other routes) ──────────────
async function fireWebhooks(bizId, event, payload) {
  try {
    const [hooks] = await pool.execute(
      "SELECT * FROM webhooks WHERE business_id = ? AND is_active = 1 AND JSON_CONTAINS(events, ?)",
      [bizId, JSON.stringify(event)]
    );
    for (const hook of hooks) {
      const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
      // Fire-and-forget
      httpPost(hook.url, { 'Content-Type': 'application/json', 'X-FishBill-Event': event }, body)
        .then(async (r) => {
          await pool.execute('UPDATE webhooks SET last_fired = NOW() WHERE id = ?', [hook.id]);
          await logIntegration(bizId, 'webhook', event, r.ok ? 'success' : 'failed', hook.url, null, r.ok ? null : r.body, { hookId: hook.id });
        })
        .catch(() => {});
    }
  } catch (e) { console.error('[webhook fire]', e.message); }
}

module.exports = router;
module.exports.sendEmail  = sendEmail;
module.exports.sendSms    = sendSms;
module.exports.fireWebhooks = fireWebhooks;
module.exports.transmitToProvider = transmitToProvider;
module.exports.buildMyDataXml = buildMyDataXml;
