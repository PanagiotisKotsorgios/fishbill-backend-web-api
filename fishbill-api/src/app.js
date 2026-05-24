const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const logger     = require('./utils/logger');

const app = express();

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

app.use('/api/', generalLimiter);
app.use('/api/auth/login',           loginLimiter);
app.use('/api/auth/admin-login',     loginLimiter);
app.use('/api/auth/forgot-password', sensitiveAuthLimiter);
app.use('/api/auth/owner-recovery',  sensitiveAuthLimiter);

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

  // MySQL: connection lost / timeout
  if (err.code && err.code.startsWith('ER_') ) {
    return res.status(503).json({ error: 'Πρόβλημα σύνδεσης με τη βάση δεδομένων. Δοκιμάστε ξανά.' });
  }

  const statusCode = err.statusCode || err.status || 500;
  const message = statusCode === 500
    ? 'Παρουσιάστηκε σφάλμα. Δοκιμάστε ξανά αργότερα.'
    : err.message || 'Παρουσιάστηκε σφάλμα.';

  res.status(statusCode).json({ error: message });
});

module.exports = app;
