const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const logger     = require('./utils/logger');

const app = express();

// Trust Traefik/Coolify reverse proxy — required for express-rate-limit and
// correct IP detection when running behind a proxy
app.set('trust proxy', 1);

// ── Wrapp webhook — registered BEFORE CORS/rate-limit middleware ──────────────
// Wrapp servers may send an Origin header we don't know in advance; bypassing
// CORS for this single endpoint avoids HTTP 500 CORS rejections.
// Body parsers are applied inline so this handler is self-contained.
const fs   = require('fs');
const _wLogFile = path.join(__dirname, '../logs/wrapp.log');
try { fs.mkdirSync(path.dirname(_wLogFile), { recursive: true }); } catch (_) {}
function _wlog(level, msg, data) {
  const ts   = new Date().toISOString();
  const line = data !== undefined
    ? `[${ts}] [${level}] [WEBHOOK] ${msg} ${JSON.stringify(data)}`
    : `[${ts}] [${level}] [WEBHOOK] ${msg}`;
  if (level === 'ERROR') console.error(line); else console.log(line);
  try { fs.appendFileSync(_wLogFile, line + '\n'); } catch (_) {}
}

// GET probe — lets us verify the webhook URL is publicly reachable
app.get('/api/wrapp/webhook', (req, res) => {
  _wlog('INFO', 'GET probe on webhook endpoint', { ip: req.ip, ua: req.headers['user-agent'] });
  res.json({ ok: true, endpoint: '/api/wrapp/webhook', method: 'POST' });
});

app.post('/api/wrapp/webhook',
  express.json(),
  express.urlencoded({ extended: true }),
  async (req, res) => {
    try {
      _wlog('INFO', 'Incoming webhook request', {
        ip: req.ip,
        origin: req.headers['origin'] || null,
        body: req.body,
      });

      // Accept both snake_case and camelCase field names from Wrapp
      const body            = req.body || {};
      const api_key         = body.api_key         || body.apiKey         || null;
      const wrapp_user_id   = body.wrapp_user_id   || body.wrappUserId    || null;
      const partner_user_id = body.partner_user_id || body.partnerUserId  || null;
      const my_data_mark    = body.my_data_mark    || body.myDataMark     || null;
      // Wrapp's `issued-invoice` event delivers the document id in `id`,
      // the `invoice-pdf` / `invoice-thermal-pdf` events use `invoice_id`.
      // Our own onboarding webhook may include `wrapp_invoice_id`. Accept
      // all three so a spec-strict event always lands in the right branch.
      const wrapp_invoice_id = body.id || body.invoice_id || body.wrapp_invoice_id || null;
      _wlog('INFO', 'Parsed webhook fields', {
        api_key: api_key ? api_key.slice(0,8)+'...' : null,
        wrapp_user_id, partner_user_id,
        my_data_mark, wrapp_invoice_id,
      });

      // ── PDF ready webhook: Wrapp generated PDF and is delivering the download URL ─
      const download_url = body.download_url || body.downloadUrl || null;
      if (download_url && wrapp_invoice_id) {
        _wlog('INFO', 'PDF ready webhook received', { wrapp_invoice_id, download_url });
        const pool = require('./config/database');
        // Try invoices first, then delivery notes
        const [[invPdf]] = await pool.execute(
          'SELECT id FROM invoices WHERE wrapp_invoice_id = ? LIMIT 1', [wrapp_invoice_id]
        );
        if (invPdf) {
          await pool.execute(
            'UPDATE invoices SET wrapp_pdf_url=?, updated_at=NOW() WHERE id=?',
            [download_url, invPdf.id]
          );
          _wlog('INFO', 'Invoice wrapp_pdf_url updated via webhook', { invoice_id: invPdf.id });
          return res.json({ ok: true, updated: 'invoice_pdf', invoice_id: invPdf.id });
        }
        const [[dnPdf]] = await pool.execute(
          'SELECT id FROM delivery_notes WHERE wrapp_invoice_id = ? LIMIT 1', [wrapp_invoice_id]
        );
        if (dnPdf) {
          await pool.execute(
            'UPDATE delivery_notes SET wrapp_pdf_url=?, updated_at=NOW() WHERE id=?',
            [download_url, dnPdf.id]
          );
          _wlog('INFO', 'Delivery note wrapp_pdf_url updated via webhook', { dn_id: dnPdf.id });
          return res.json({ ok: true, updated: 'delivery_note_pdf', dn_id: dnPdf.id });
        }
        _wlog('WARN', 'PDF webhook: wrapp_invoice_id not found', { wrapp_invoice_id });
        return res.json({ ok: false, error: 'Document not found.', wrapp_invoice_id });
      }

      // ── Cancellation MARK webhook: Wrapp completed an async DN cancel ─────
      // Wrapp posts back the same `issued-invoice` event with cancelled_by_mark
      // populated once myDATA confirms the cancellation. Capture it on the DN.
      const cancelled_by_mark = body.cancelled_by_mark || body.cancelledByMark || null;
      if (cancelled_by_mark && wrapp_invoice_id) {
        _wlog('INFO', 'Cancellation MARK webhook received', { wrapp_invoice_id, cancelled_by_mark });
        const pool = require('./config/database');
        const [[dnCancel]] = await pool.execute(
          'SELECT id FROM delivery_notes WHERE wrapp_invoice_id = ? LIMIT 1', [wrapp_invoice_id]
        );
        if (dnCancel) {
          await pool.execute(
            `UPDATE delivery_notes
             SET cancellation_mark    = ?,
                 cancellation_pending = 0,
                 status               = 'cancelled',
                 updated_at           = NOW()
             WHERE id = ?`,
            [cancelled_by_mark, dnCancel.id]
          );
          _wlog('INFO', 'Delivery note cancellation_mark updated via webhook', { dn_id: dnCancel.id, mark: cancelled_by_mark });
          return res.json({ ok: true, updated: 'delivery_note_cancellation', dn_id: dnCancel.id, mark: cancelled_by_mark });
        }
        _wlog('WARN', 'Cancellation MARK webhook: wrapp_invoice_id not found', { wrapp_invoice_id });
        // fall through — maybe other handlers want it too
      }

      // ── MARK update webhook: Wrapp resolved myDATA asynchronously ──────────
      if (my_data_mark && wrapp_invoice_id) {
        _wlog('INFO', 'MARK update webhook received', { wrapp_invoice_id, my_data_mark });
        const pool = require('./config/database');
        const qrUrl = body.my_data_qr_url || body.myDataQrUrl || null;
        const uid   = body.my_data_uid    || body.myDataUid   || null;

        // Try invoices first
        const [[inv]] = await pool.execute(
          'SELECT id, business_id FROM invoices WHERE wrapp_invoice_id = ? LIMIT 1',
          [wrapp_invoice_id]
        );
        if (inv) {
          await pool.execute(
            `UPDATE invoices SET mydata_mark=?, mydata_qr=?, status='transmitted',
             transmitted_at=COALESCE(transmitted_at, NOW()), updated_at=NOW() WHERE id=?`,
            [my_data_mark, qrUrl, inv.id]
          );
          await pool.execute(
            `INSERT INTO transmission_logs (invoice_id, provider, success, mydata_mark, attempted_at)
             VALUES (?, 'wrapp', 1, ?, NOW())
             ON DUPLICATE KEY UPDATE mydata_mark=VALUES(mydata_mark)`,
            [inv.id, my_data_mark]
          ).catch(() => {});
          _wlog('INFO', 'Invoice MARK updated via webhook', { invoice_id: inv.id, mark: my_data_mark });
          return res.json({ ok: true, updated: 'invoice', invoice_id: inv.id, mark: my_data_mark });
        }

        // Try delivery notes
        const [[dn]] = await pool.execute(
          'SELECT id FROM delivery_notes WHERE wrapp_invoice_id = ? LIMIT 1',
          [wrapp_invoice_id]
        );
        if (dn) {
          await pool.execute(
            `UPDATE delivery_notes SET mydata_mark=?, mydata_uid=?, wrapp_qr_url=?, status='transmitted',
             transmitted_at=COALESCE(transmitted_at, NOW()), updated_at=NOW() WHERE id=?`,
            [my_data_mark, uid, qrUrl, dn.id]
          );
          _wlog('INFO', 'Delivery note MARK updated via webhook', { dn_id: dn.id, mark: my_data_mark });
          return res.json({ ok: true, updated: 'delivery_note', dn_id: dn.id, mark: my_data_mark });
        }

        _wlog('WARN', 'MARK webhook: wrapp_invoice_id not found in invoices or delivery_notes', { wrapp_invoice_id });
        return res.json({ ok: false, error: 'Document not found.', wrapp_invoice_id });
      }

      // ── Onboarding webhook: no MARK → must have api_key ───────────────────
      if (!api_key) {
        _wlog('ERROR', 'Missing api_key in webhook body — all known field names tried', body);
        // Return 200 so Wrapp doesn't retry indefinitely; log the error
        return res.json({ ok: false, error: 'Missing api_key.' });
      }

      const pool  = require('./config/database');
      const wrapp = require('./services/wrapp.service');

      // Resolve business: Wrapp echoes our partner_user_id (UUID).
      // Fallback: look up by owner email if partner_user_id doesn't match directly.
      let resolvedBizId = null;
      if (partner_user_id) {
        const [[byId]] = await pool.execute(
          'SELECT id FROM businesses WHERE id = ? LIMIT 1', [partner_user_id]
        );
        if (byId) {
          resolvedBizId = byId.id;
          _wlog('INFO', `Business resolved by partner_user_id`, { partner_user_id, biz_id: resolvedBizId });
        } else if (wrapp_user_id) {
          _wlog('WARN', `partner_user_id not found as UUID, trying email fallback`, { partner_user_id, wrapp_user_id });
          const [[byEmail]] = await pool.execute(
            `SELECT b.id FROM businesses b
             JOIN users u ON u.business_id = b.id AND u.role = 'owner'
             WHERE u.email = ? OR b.email = ? LIMIT 1`,
            [wrapp_user_id, wrapp_user_id]
          );
          if (byEmail) {
            resolvedBizId = byEmail.id;
            _wlog('INFO', `Business resolved by email fallback`, { email: wrapp_user_id, biz_id: resolvedBizId });
          }
        }
      }

      if (!resolvedBizId) {
        _wlog('ERROR', 'Cannot resolve business — no match found', { partner_user_id, wrapp_user_id });
        // Still return 200 so Wrapp doesn't keep retrying; we log the failure
        return res.json({ ok: false, error: 'Business not found.', partner_user_id });
      }

      await pool.execute(
        `UPDATE businesses
         SET wrapp_api_key = ?, wrapp_user_id = ?, wrapp_enabled = 1, updated_at = NOW()
         WHERE id = ?`,
        [api_key, wrapp_user_id || null, resolvedBizId]
      );
      wrapp.invalidateCache(resolvedBizId);
      _wlog('INFO', 'Credentials saved to DB', {
        biz_id: resolvedBizId,
        wrapp_user_id,
        api_key_prefix: api_key ? api_key.slice(0, 8) + '...' : null,
      });

      try {
        const [[bizRow]] = await pool.execute(
          'SELECT subscription_active, COALESCE(is_first_subscription, 1) AS is_first FROM businesses WHERE id = ? LIMIT 1',
          [resolvedBizId]
        );
        if (bizRow && !bizRow.subscription_active) {
          const isFirst    = bizRow.is_first === 1;
          const monthCount = 12 + (isFirst ? 1 : 0);
          const endDate    = new Date();
          endDate.setMonth(endDate.getMonth() + monthCount);
          await pool.execute(
            `UPDATE businesses SET subscription_active = 1, plan = 'pro', billing_cycle = 'annual',
             subscription_ends_at = ?, is_first_subscription = 0, updated_at = NOW()
             WHERE id = ? AND subscription_active = 0`,
            [endDate, resolvedBizId]
          );
          await pool.execute(
            `INSERT INTO business_settings (business_id, feature_ospa, feature_weighing_slips)
             VALUES (?, 1, 1)
             ON DUPLICATE KEY UPDATE feature_ospa = 1, feature_weighing_slips = 1`,
            [resolvedBizId]
          );
          _wlog('INFO', 'Subscription auto-activated via Wrapp webhook', {
            biz_id: resolvedBizId,
            months: monthCount,
            first_subscription_bonus: isFirst,
            ends_at: endDate.toISOString().slice(0, 10),
          });
        } else {
          _wlog('DEBUG', 'Subscription already active — no change', { biz_id: resolvedBizId });
        }
      } catch (activateErr) {
        _wlog('ERROR', 'Auto-activate subscription failed', { error: activateErr.message });
      }

      _wlog('INFO', 'Webhook processed successfully', { biz_id: resolvedBizId });
      res.json({ ok: true });
    } catch (err) {
      _wlog('ERROR', 'Unhandled webhook error', { error: err.message, stack: err.stack });
      res.status(500).json({ error: 'Internal error.' });
    }
  }
);

// ── Security headers (with HSTS + CSP) ───────────────────────────────────────
app.use(helmet({
  // HTTP Strict Transport Security — tell browsers to only use HTTPS for 1 year
  hsts: {
    maxAge: 31536000,           // 1 year in seconds
    includeSubDomains: true,
    preload: true,
  },
  // Content Security Policy — prevent XSS / content injection
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", 'data:', 'https:'],
      connectSrc:  ["'self'"],
      fontSrc:     ["'self'", 'https:'],
      objectSrc:   ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  // Prevent MIME sniffing
  noSniff: true,
  // Prevent clickjacking
  frameguard: { action: 'deny' },
  // Remove X-Powered-By
  hidePoweredBy: true,
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    logger.warn('CORS blocked', { origin });
    callback(new Error(`CORS policy: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── HTTP access logging ───────────────────────────────────────────────────────
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat, { stream: logger.stream }));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiters ─────────────────────────────────────────────────────────────

// General: 1 000 req / 15 min per IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Πολλά αιτήματα. Δοκιμάστε ξανά σε λίγα λεπτά.' },
});

// Login: 30 req / 60 min per IP
const loginLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Πολλές απόπειρες σύνδεσης. Δοκιμάστε ξανά σε 1 ώρα.' },
});

// Sensitive auth flows (password reset, OTP, recovery): 5 req / 10 min per IP
const sensitiveAuthLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Πολλές απόπειρες. Περιμένετε 10 λεπτά και δοκιμάστε ξανά.' },
  skipSuccessfulRequests: false,
});

// Token refresh: generous but bounded — prevents token-farming attacks
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Πολλές ανανεώσεις διακριτικού. Δοκιμάστε ξανά σε 15 λεπτά.' },
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login',                loginLimiter);
app.use('/api/auth/admin-login',          loginLimiter);
app.use('/api/auth/forgot-password',      sensitiveAuthLimiter);
app.use('/api/auth/owner-recovery',       sensitiveAuthLimiter);
app.use('/api/auth/reset-password',       sensitiveAuthLimiter);
app.use('/api/auth/owner-recovery-login', sensitiveAuthLimiter);
app.use('/api/auth/refresh',              refreshLimiter);
app.use('/api/admin/otp',                 sensitiveAuthLimiter);

// ── Static files — avatars + weighing-slip images ────────────────────────────
app.use('/avatars', express.static(path.join(__dirname, '../public/avatars')));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));
// ── APK downloads — no auth required so DownloadManager can fetch directly ───
app.use('/apk', express.static(path.join(__dirname, '../public/apk'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.apk')) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment');
    }
  }
}));
app.use('/uploads/invoices', express.static(path.join(__dirname, '../uploads/invoices')));
app.use('/uploads/delivery-notes', express.static(path.join(__dirname, '../uploads/delivery-notes')));

// ── Public PDFs (no auth required — needed for offline caching on devices) ───
app.use('/pdfs', express.static(path.join(__dirname, '../pdfs'), {
  setHeaders: (res) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
  }
}));

// ── Public landing-page stats (no auth) ──────────────────────────────────────
app.get('/api/public/stats', async (req, res) => {
  try {
    const pool = require('./config/database');
    const [[row]] = await pool.execute(`
      SELECT
        (SELECT COUNT(*) FROM businesses WHERE is_active = 1)                        AS fishermen,
        (SELECT COUNT(*) FROM invoices WHERE status != 'draft')                      AS invoices,
        (SELECT COUNT(*) FROM invoices WHERE status = 'transmitted')                 AS transmitted,
        (SELECT COUNT(*) FROM invoices WHERE status IN ('transmitted','failed'))     AS attempted
    `);
    const attempted    = parseInt(row.attempted)    || 0;
    const transmitted  = parseInt(row.transmitted)  || 0;
    const successRate  = attempted > 0 ? Math.round((transmitted / attempted) * 100) : 98;
    res.json({
      fishermen:    parseInt(row.fishermen) || 0,
      invoices:     parseInt(row.invoices)  || 0,
      success_rate: successRate,
    });
  } catch { res.json({ fishermen: 0, invoices: 0, success_rate: 98 }); }
});

// ── Public site config (no auth) — used by coming-soon page ─────────────────
app.get('/api/public/config', async (req, res) => {
  try {
    const pool = require('./config/database');
    const [rows] = await pool.execute(
      "SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN ('web_base_url','app_base_url')"
    );
    const map = {};
    rows.forEach(r => { map[r.setting_key] = r.setting_value; });
    res.json({
      web_base_url: map.web_base_url || null,
      app_base_url: map.app_base_url || null,
    });
  } catch { res.json({ web_base_url: null, app_base_url: null }); }
});

// ── Public maintenance status (no auth) ──────────────────────────────────────
app.get('/api/status', async (req, res) => {
  try {
    const pool = require('./config/database');
    const [rows] = await pool.execute(
      "SELECT setting_key, setting_value FROM platform_settings WHERE setting_key IN ('maintenance_mode','maintenance_message')"
    );
    const map = {};
    rows.forEach(r => { map[r.setting_key] = r.setting_value; });
    res.json({
      maintenance: map.maintenance_mode === '1' || map.maintenance_mode === 'true',
      message: map.maintenance_message || 'Εκτελούνται εργασίες συντήρησης. Σύντομα θα είμαστε πάλι κοντά σας.',
    });
  } catch { res.json({ maintenance: false, message: '' }); }
});

// ── Health check (with DB ping) ───────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const start = Date.now();
  try {
    const pool = require('./config/database');
    await pool.execute('SELECT 1');
    res.json({
      status:      'ok',
      service:     'fishbill-api',
      timestamp:   new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      uptime:      Math.floor(process.uptime()),
      db_ping_ms:  Date.now() - start,
    });
  } catch (err) {
    logger.error('Health check DB ping failed', { error: err.message });
    res.status(503).json({
      status:    'degraded',
      service:   'fishbill-api',
      timestamp: new Date().toISOString(),
      error:     'Database unreachable',
    });
  }
});

// ── Routes ────────────────────────────────────────────────────────────────────
const { authenticate, requireActiveSubscription } = require('./middleware/auth');
const gate = [authenticate, requireActiveSubscription];

// Subscription-gated: require active subscription to use business features
app.use('/api/dashboard',      gate, require('./routes/dashboard.routes'));
app.use('/api/customers',      gate, require('./routes/customers.routes'));
app.use('/api/products',       gate, require('./routes/products.routes'));
app.use('/api/invoices',       gate, require('./routes/invoices.routes'));
app.use('/api/stats',          gate, require('./routes/stats.routes'));
app.use('/api/exports',        gate, require('./routes/exports.routes'));
app.use('/api/search',         gate, require('./routes/search.routes'));
app.use('/api/iris',           gate, require('./routes/iris.routes'));
app.use('/api/integrations',   gate, require('./routes/integrations.routes'));
app.use('/api/employees',      gate, require('./routes/employee.routes'));
app.use('/api/delivery-notes',  gate, require('./routes/delivery-notes.routes'));
app.use('/api/weighing-slips',  gate, require('./routes/weighing-slips.routes'));
app.use('/api/ospa',            gate, require('./routes/ospa.routes'));
app.use('/api/configure',       gate, require('./routes/configure.routes'));
app.use('/api/mydata',         gate, require('./routes/mydata.routes'));

// Free routes: auth, subscription management, profile, notifications, admin
app.use('/api/auth',           require('./routes/auth.routes'));
app.use('/api/businesses',     require('./routes/businesses.routes'));
app.use('/api/users',          require('./routes/users.routes'));
app.use('/api/logs',           require('./routes/logs.routes'));
app.use('/api/notifications',  require('./routes/notifications.routes'));
app.use('/api/backups',        require('./routes/backups.routes'));
app.use('/api/settings',       require('./routes/settings.routes'));
app.use('/api/subscription',   require('./routes/subscription.routes'));
app.use('/api/accountant',     require('./routes/accountant.routes'));
app.use('/api/platform',       require('./routes/platform.routes'));
app.use('/api/monitor',        require('./routes/monitor.routes'));
app.use('/api/afm',            require('./routes/afm.routes'));
app.use('/api/admin/otp',      authenticate, require('./routes/admin-otp.routes'));
app.use('/api/employee-actions',   require('./routes/employee-actions.routes'));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
  });

  if (err.message && err.message.startsWith('CORS policy')) {
    return res.status(403).json({ error: 'Δεν επιτρέπεται η πρόσβαση.' });
  }

  // MySQL: duplicate unique key (e.g. invoice number collision)
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Υπάρχει ήδη εγγραφή με αυτά τα στοιχεία. Δοκιμάστε ξανά.' });
  }

  // MySQL: foreign key — referenced row missing
  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({ error: 'Δεν βρέθηκε η σχετική εγγραφή.' });
  }

  // MySQL: foreign key — row in use by other records
  if (err.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(400).json({ error: 'Δεν είναι δυνατή η διαγραφή λόγω συνδεδεμένων εγγραφών.' });
  }

  // MySQL: unknown column (missing migration)
  if (err.code === 'ER_BAD_FIELD_ERROR') {
    return res.status(500).json({ error: 'Σφάλμα βάσης δεδομένων: λείπει στήλη. Επικοινωνήστε με την υποστήριξη.' });
  }
  // MySQL: connection lost / timeout
  if (err.code && err.code.startsWith('ER_')) {
    return res.status(503).json({ error: 'Πρόβλημα σύνδεσης με τη βάση δεδομένων. Δοκιμάστε ξανά.' });
  }

  const statusCode = err.statusCode || err.status || 500;
  const message = statusCode === 500
    ? 'Παρουσιάστηκε σφάλμα. Δοκιμάστε ξανά αργότερα.'
    : err.message || 'Παρουσιάστηκε σφάλμα.';

  res.status(statusCode).json({ error: message });
});

module.exports = app;
