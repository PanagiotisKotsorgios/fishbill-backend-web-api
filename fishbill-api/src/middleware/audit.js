const pool = require('../config/database');

/**
 * Returns an async Express middleware that inserts an audit log entry AFTER
 * the response has been sent. It is non-blocking — errors are swallowed so
 * they never affect the HTTP response.
 *
 * @param {string} action      - audit action label, e.g. 'CREATE_INVOICE'
 * @param {string} entityType  - entity type label, e.g. 'invoice'
 */
function logAudit(action, entityType) {
  return async (req, res, next) => {
    // Hook into response finish event so we log AFTER the response is sent
    res.on('finish', () => {
      // Run asynchronously, do not block the response
      setImmediate(async () => {
        try {
          const userId = req.user ? req.user.id : null;
          const businessId = req.user ? req.user.business_id : null;
          const entityId = req.params && req.params.id ? req.params.id : null;
          const ipAddress =
            req.ip ||
            (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
            req.connection.remoteAddress ||
            null;

          const description = `${req.method} ${req.originalUrl} - HTTP ${res.statusCode}`;

          await pool.execute(
            `INSERT INTO audit_logs
               (user_id, business_id, action, entity_type, entity_id, description, ip_address, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [userId, businessId, action, entityType, entityId, description, ipAddress]
          );
        } catch (err) {
          // Non-blocking: just log to console, never throw
          console.error('[Audit] Failed to write audit log:', err.message);
        }
      });
    });

    next();
  };
}

module.exports = { logAudit };
