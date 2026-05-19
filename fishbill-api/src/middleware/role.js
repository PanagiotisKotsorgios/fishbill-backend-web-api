/**
 * Returns middleware that checks whether req.user.role is one of the allowed roles.
 * Must be used AFTER the authenticate middleware.
 * @param {...string} roles - allowed role names
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role(s): ${roles.join(', ')}. Your role: ${req.user.role}`,
      });
    }
    next();
  };
}

const requireSuperAdmin = requireRole('super_admin');
const requireOwnerOrAbove = requireRole('super_admin', 'owner');

module.exports = { requireRole, requireSuperAdmin, requireOwnerOrAbove };
