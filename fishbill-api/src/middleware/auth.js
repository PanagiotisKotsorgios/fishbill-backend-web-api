const jwt = require('jsonwebtoken');
const pool = require('../config/database');

/**
 * Authenticate requests via Bearer JWT token.
 * Attaches the DB user object to req.user on success.
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required. Provide a Bearer token.' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Authentication token missing.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired. Please refresh your session.' });
      }
      return res.status(401).json({ error: 'Invalid authentication token.' });
    }

    const [rows] = await pool.execute(
      'SELECT id, business_id, role, is_active FROM users WHERE id = ? LIMIT 1',
      [decoded.id]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'User not found.' });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact your administrator.' });
    }

    req.user = user;

    // Update last_seen_at (fire-and-forget — max once every 60s to avoid DB hammering)
    const now = Date.now();
    const key = `lsa_${user.id}`;
    if (!authenticate._lastSeen) authenticate._lastSeen = {};
    if (!authenticate._lastSeen[key] || now - authenticate._lastSeen[key] > 60000) {
      authenticate._lastSeen[key] = now;
      pool.execute('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [user.id]).catch(() => {});
    }

    next();
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Subscription gate — 402 if business has no active subscription.
// Skips check for admin/platform roles; those don't go through fisherman routes.
// ---------------------------------------------------------------------------
async function requireActiveSubscription(req, res, next) {
  try {
    if (!req.user?.business_id) return next();
    if (req.user.role && !['owner', 'employee'].includes(req.user.role)) return next();
    const [rows] = await pool.execute(
      'SELECT subscription_active FROM businesses WHERE id = ? LIMIT 1',
      [req.user.business_id]
    );
    if (!rows.length || rows[0].subscription_active !== 1) {
      return res.status(402).json({ error: 'subscription_inactive' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate, requireActiveSubscription };
