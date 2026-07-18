const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');

const logger      = require('./utils/logger');

const authRoutes          = require('./routes/auth.routes');
const invoicesRoutes      = require('./routes/invoices.routes');
const deliveryNotesRoutes = require('./routes/delivery-notes.routes');
const dashboardRoutes     = require('./routes/dashboard.routes');
const subscriptionRoutes  = require('./routes/subscription.routes');
const wrappWebhookRoutes  = require('./routes/wrapp-webhook.routes');
const adminRoutes         = require('./routes/admin.routes');

const app = express();

// Behind the Coolify/nginx reverse proxy — required so req.ip and
// express-rate-limit read X-Forwarded-For properly instead of the socket IP.
app.set('trust proxy', 1);

// ── Middleware ─────────────────────────────────────────────────────────────
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// Raw body capture for webhook HMAC signature verification
app.use((req, res, next) => {
  if (req.path.startsWith('/webhooks/')) {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => data += chunk);
    req.on('end', () => {
      req.rawBody = data;
      try { req.body = data ? JSON.parse(data) : {}; } catch { req.body = {}; }
      next();
    });
  } else {
    express.json({ limit: '5mb' })(req, res, next);
  }
});

// Global rate limit — 300 requests / 15 min per IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'agrotis-api',
    env: process.env.NODE_ENV || 'development',
    wrapp: process.env.WRAPP_BASE_URL ? 'configured' : 'not configured',
    ts: new Date().toISOString(),
  });
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/auth',            authRoutes);
app.use('/invoices',        invoicesRoutes);
app.use('/delivery-notes',  deliveryNotesRoutes);
app.use('/dashboard',       dashboardRoutes);
app.use('/subscription',    subscriptionRoutes);
app.use('/webhooks/wrapp',  wrappWebhookRoutes);
app.use('/admin',           adminRoutes);

// ── 404 + error handler ────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

app.use((err, req, res, next) => {
  logger.error(`Unhandled error on ${req.method} ${req.originalUrl}: ${err.stack || err}`);
  const status = err.status || 500;
  const payload = {
    error: err.publicMessage || (status === 500 ? 'Internal server error' : err.message),
  };
  // In non-production, include stack trace so debugging is easier from the browser.
  if (process.env.NODE_ENV !== 'production') {
    payload.stack = String(err.stack || err);
  } else if (status >= 500) {
    // In prod, at least include a short message to help identify the failing query.
    payload.detail = String(err.message || err);
  }
  res.status(status).json(payload);
});

module.exports = app;
