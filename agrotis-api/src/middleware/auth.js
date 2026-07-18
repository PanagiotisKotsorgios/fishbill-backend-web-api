const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Refusing to start.');
  process.exit(1);
}

function signAccess(payload) {
  return jwt.sign(payload, SECRET, {
    expiresIn: process.env.JWT_ACCESS_TTL || '1d',
    issuer:    'agrotis-api',
  });
}

function signRefresh(payload) {
  return jwt.sign({ ...payload, kind: 'refresh' }, SECRET, {
    expiresIn: process.env.JWT_REFRESH_TTL || '30d',
    issuer:    'agrotis-api',
  });
}

function verify(token) {
  return jwt.verify(token, SECRET, { issuer: 'agrotis-api' });
}

/** Express middleware — parses Bearer token, populates req.user. */
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const [scheme, token] = h.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  try {
    req.user = verify(token);
    if (req.user.kind === 'refresh') {
      return res.status(401).json({ error: 'Cannot use refresh token for API calls' });
    }
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Admin role required' });
    }
    next();
  });
}

module.exports = { signAccess, signRefresh, verify, requireAuth, requireAdmin };
