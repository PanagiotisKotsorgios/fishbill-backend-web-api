const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const Joi = require('joi');
const fs = require('fs');
const emailSvc = require('../services/email.service');
const path = require('path');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireOwnerOrAbove } = require('../middleware/role');
const { validate } = require('../middleware/validate');
const { logAudit } = require('../middleware/audit');

router.use(authenticate);

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const createUserSchema = Joi.object({
  business_id: Joi.alternatives().try(Joi.string().uuid(), Joi.number().integer()).optional().allow(null),
  name: Joi.string().min(2).max(255).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  role: Joi.string().valid('super_admin', 'owner', 'accountant', 'viewer').required(),
});

const updateUserSchema = Joi.object({
  name: Joi.string().min(2).max(255).optional(),
  email: Joi.string().email().optional(),
  role: Joi.string().valid('super_admin', 'owner', 'accountant', 'viewer').optional(),
  is_active: Joi.number().valid(0, 1).optional(),
});

const resetPasswordSchema = Joi.object({
  password: Joi.string().min(8).required(),
});

// ---------------------------------------------------------------------------
// GET /api/users
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    if (req.user.role === 'super_admin') {
      // no base restriction
    } else {
      conditions.push('u.business_id = ?');
      params.push(req.user.business_id);
    }

    // Search filter
    if (req.query.q) {
      const q = `%${req.query.q}%`;
      conditions.push('(u.full_name LIKE ? OR u.email LIKE ?)');
      params.push(q, q);
    }
    if (req.query.role) {
      conditions.push('u.role = ?');
      params.push(req.query.role);
    }
    if (req.query.active !== undefined && req.query.active !== '') {
      conditions.push('u.is_active = ?');
      params.push(parseInt(req.query.active));
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM users u ${whereClause}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT u.id, u.business_id, u.full_name AS name, u.email, u.role, u.is_active,
              u.is_verified, u.avatar_url, u.last_login_at AS last_login, u.created_at, b.name AS business_name
       FROM users u
       LEFT JOIN businesses b ON b.id = u.business_id
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    res.json({ data: rows, total: countRows[0].total, page, limit });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/users
// ---------------------------------------------------------------------------
router.post(
  '/',
  requireOwnerOrAbove,
  validate(createUserSchema),
  logAudit('CREATE_USER', 'user'),
  async (req, res, next) => {
    try {
      const { name, email, password, role } = req.body;
      let { business_id } = req.body;

      // Non-super_admin must create users in their own business
      if (req.user.role !== 'super_admin') {
        business_id = req.user.business_id;
        if (role === 'super_admin') {
          return res.status(403).json({ error: 'Cannot create super_admin users.' });
        }
      }

      if (!business_id && role !== 'super_admin') {
        return res.status(400).json({ error: 'business_id is required.' });
      }
      if (!business_id) business_id = null;

      const [existing] = await pool.execute(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        [email]
      );
      if (existing.length) {
        return res.status(409).json({ error: 'Email already in use.' });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      const [result] = await pool.execute(
        `INSERT INTO users (id, business_id, full_name, email, password_hash, role, is_active, created_at, updated_at)
         VALUES (UUID(), ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
        [business_id, name, email, passwordHash, role]
      );

      // Fetch newly created user by email (since we used UUID() in SQL)
      const [newUser] = await pool.execute(
        'SELECT id, business_id, full_name AS name, email, role, is_active, created_at FROM users WHERE email = ? LIMIT 1',
        [email]
      );

      res.status(201).json({ data: newUser[0] });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/users/me/avatar   — self-service avatar upload (base64 JSON)
// ---------------------------------------------------------------------------
router.patch('/me/avatar', async (req, res, next) => {
  try {
    const { avatar_base64, mime_type } = req.body;

    if (!avatar_base64) {
      return res.status(400).json({ error: 'avatar_base64 απαιτείται.' });
    }

    const base64Data = avatar_base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Limit size to ~3MB raw
    if (buffer.length > 3 * 1024 * 1024) {
      return res.status(400).json({ error: 'Η εικόνα είναι πολύ μεγάλη (max 3MB).' });
    }

    const ext = (mime_type === 'image/png') ? 'png' : 'jpg';
    const filename = `${req.user.id}_${Date.now()}.${ext}`;
    const uploadsDir = path.join(__dirname, '../../public/avatars');

    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Delete previous avatar for this user
    try {
      const existing = fs.readdirSync(uploadsDir).filter(f => f.startsWith(req.user.id + '_'));
      existing.forEach(f => fs.unlinkSync(path.join(uploadsDir, f)));
    } catch (_) {}

    fs.writeFileSync(path.join(uploadsDir, filename), buffer);

    const avatar_url = `/avatars/${filename}`;
    await pool.execute(
      'UPDATE users SET avatar_url = ?, updated_at = NOW() WHERE id = ?',
      [avatar_url, req.user.id]
    );

    res.json({ data: { avatar_url } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/users/:id
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute(
      `SELECT u.id, u.business_id, u.full_name AS name, u.email, u.role, u.is_active,
              u.avatar_url, u.last_login_at AS last_login, u.created_at, u.updated_at,
              b.name AS business_name
       FROM users u
       LEFT JOIN businesses b ON b.id = u.business_id
       WHERE u.id = ? LIMIT 1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = rows[0];

    // Access control
    if (req.user.role !== 'super_admin' && user.business_id != req.user.business_id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    res.json({ data: user });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/users/:id
// ---------------------------------------------------------------------------
router.put(
  '/:id',
  requireOwnerOrAbove,
  validate(updateUserSchema),
  logAudit('UPDATE_USER', 'user'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const [existing] = await pool.execute(
        'SELECT id, business_id FROM users WHERE id = ? LIMIT 1',
        [id]
      );
      if (!existing.length) {
        return res.status(404).json({ error: 'User not found.' });
      }

      if (req.user.role !== 'super_admin' && existing[0].business_id != req.user.business_id) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      // Map API field names to DB column names
      const fieldMap = { name: 'full_name', email: 'email', role: 'role', is_active: 'is_active' };
      const allowedFields = Object.keys(fieldMap);
      const setClauses = [];
      const params = [];

      for (const apiField of allowedFields) {
        if (req.body[apiField] !== undefined) {
          const dbField = fieldMap[apiField];
          setClauses.push(`${dbField} = ?`);
          params.push(req.body[apiField]);
        }
      }

      if (!setClauses.length) {
        return res.status(400).json({ error: 'No updatable fields provided.' });
      }

      setClauses.push('updated_at = NOW()');
      params.push(id);

      await pool.execute(
        `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`,
        params
      );

      const [updated] = await pool.execute(
        'SELECT id, business_id, full_name AS name, email, role, is_active, created_at, updated_at FROM users WHERE id = ?',
        [id]
      );

      res.json({ data: updated[0] });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/users/:id  — soft delete (deactivate)
// ---------------------------------------------------------------------------
router.delete(
  '/:id',
  requireOwnerOrAbove,
  logAudit('DELETE_USER', 'user'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      if (req.user.id == id) {
        return res.status(400).json({ error: 'Cannot deactivate your own account.' });
      }

      const [existing] = await pool.execute(
        'SELECT id, business_id FROM users WHERE id = ? LIMIT 1',
        [id]
      );
      if (!existing.length) {
        return res.status(404).json({ error: 'User not found.' });
      }

      if (req.user.role !== 'super_admin' && existing[0].business_id != req.user.business_id) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      await pool.execute(
        'UPDATE users SET is_active = 0, updated_at = NOW() WHERE id = ?',
        [id]
      );

      res.json({ data: { message: 'User deactivated successfully.' } });
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/users/:id/reset-password  — admin resets user password
// ---------------------------------------------------------------------------
router.post(
  '/:id/reset-password',
  requireOwnerOrAbove,
  validate(resetPasswordSchema),
  logAudit('RESET_USER_PASSWORD', 'user'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { password } = req.body;

      const [existing] = await pool.execute(
        'SELECT id, business_id FROM users WHERE id = ? LIMIT 1',
        [id]
      );
      if (!existing.length) {
        return res.status(404).json({ error: 'User not found.' });
      }

      if (req.user.role !== 'super_admin' && existing[0].business_id != req.user.business_id) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      await pool.execute(
        'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
        [passwordHash, id]
      );

      res.json({ data: { message: 'Password reset successfully.' } });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PATCH /api/users/:id/verify — Super Admin verifies/unverifies accountant ──
router.patch('/:id/verify', async (req, res, next) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Super Admin only.' });
  try {
    const { id } = req.params;
    const { is_verified, admin_message } = req.body;
    if (is_verified === undefined) return res.status(400).json({ error: 'is_verified required.' });
    await pool.execute(
      'UPDATE users SET is_verified = ?, updated_at = NOW() WHERE id = ?',
      [is_verified ? 1 : 0, id]
    );

    // Fetch user info to send notifications
    const [userRows] = await pool.execute(
      'SELECT full_name, email FROM users WHERE id = ? LIMIT 1', [id]
    ).catch(() => [[]]);
    const target = userRows[0];

    if (target) {
      // Notify the accountant of the decision
      emailSvc.sendAccountantVerificationResult({
        to: target.email,
        toName: target.full_name,
        approved: !!is_verified,
        adminMessage: admin_message || null,
      }).catch(e => console.error('[verify] accountant email failed:', e.message));

      // Log action to admin
      emailSvc.sendAdminVerificationActionLog({
        accountantName: target.full_name,
        accountantEmail: target.email,
        approved: !!is_verified,
      }).catch(e => console.error('[verify] admin log email failed:', e.message));
    }

    res.json({ data: { message: is_verified ? 'User verified.' : 'Verification revoked.' } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /api/users/:id/request-permanent-delete  — superadmin requests deletion
//   Sends confirmation email to admin; stores token in DB
// ---------------------------------------------------------------------------
const crypto = require('crypto');

router.post(
  '/:id/request-permanent-delete',
  async (req, res, next) => {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Μόνο ο Super Admin μπορεί να αιτηθεί διαγραφή.' });
    }
    try {
      const { id } = req.params;

      if (req.user.id === id) {
        return res.status(400).json({ error: 'Δεν μπορείτε να διαγράψετε τον δικό σας λογαριασμό.' });
      }

      const [users] = await pool.execute(
        'SELECT id, full_name, email, role FROM users WHERE id = ? LIMIT 1',
        [id]
      );
      if (!users.length) return res.status(404).json({ error: 'Χρήστης δεν βρέθηκε.' });
      if (users[0].role === 'super_admin') {
        return res.status(403).json({ error: 'Δεν μπορεί να διαγραφεί Super Admin.' });
      }

      const user = users[0];
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

      // Store token in platform_settings (no extra table needed)
      await pool.execute(
        `INSERT INTO platform_settings (setting_key, setting_value)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()`,
        [
          `delete_token_${id}`,
          JSON.stringify({ token, expires: expiresAt.toISOString(), requested_by: req.user.id }),
          JSON.stringify({ token, expires: expiresAt.toISOString(), requested_by: req.user.id }),
        ]
      );

      // Send confirmation email via email service (reads SMTP from platform_settings)
      const emailSvc = require('../services/email.service');
      const adminEmail = req.user.email || process.env.ADMIN_EMAIL;
      const cfg = await emailSvc.loadConfig();
      const baseUrl = (cfg.web_base_url || process.env.APP_BASE_URL || '').replace(/\/admin\/?$/, '').replace(/\/$/, '');
      const confirmUrl = `${baseUrl}/admin/users.html?confirmDelete=1&userId=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;

      let emailSent = false;
      let emailError = null;
      if (adminEmail) {
        try {
          await emailSvc.sendEmail({
            to: adminEmail,
            subject: `[FishBill] Επιβεβαίωση Διαγραφής Χρήστη: ${user.full_name}`,
            html: `
              <div style="font-family:Inter,sans-serif;max-width:520px;margin:auto;padding:32px;background:#f9fafb;border-radius:16px">
                <h2 style="color:#DC2626;margin-bottom:8px">⚠️ Επιβεβαίωση Μόνιμης Διαγραφής</h2>
                <p style="color:#374151">Ζητήθηκε <strong>μόνιμη διαγραφή</strong> του χρήστη:</p>
                <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:16px 0">
                  <p style="margin:4px 0"><strong>Όνομα:</strong> ${user.full_name}</p>
                  <p style="margin:4px 0"><strong>Email:</strong> ${user.email}</p>
                  <p style="margin:4px 0"><strong>ID:</strong> ${user.id}</p>
                </div>
                <p style="color:#374151">Αν ΕΣΥ έκανες αυτήν την αίτηση, κάνε κλικ παρακάτω για να επιβεβαιώσεις:</p>
                <div style="text-align:center;margin:24px 0">
                  <a href="${confirmUrl}" style="display:inline-block;background:#DC2626;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:700;font-size:15px">
                    ✅ Επιβεβαίωση Διαγραφής
                  </a>
                </div>
                <p style="color:#9ca3af;font-size:12px">Ο σύνδεσμος λήγει σε <strong>30 λεπτά</strong>.</p>
              </div>`,
          });
          emailSent = true;
        } catch (emailErr) {
          emailError = emailErr.message;
          console.error('[DELETE] Email error:', emailErr.message);
        }
      }

      res.json({
        data: {
          message: emailSent
            ? `Email επιβεβαίωσης εστάλη στο ${adminEmail}.`
            : 'Email δεν εστάλη. Χρησιμοποιήστε το token στο παράθυρο επιβεβαίωσης.',
          email_error: emailError,   // shown to admin for diagnostics
          token,                     // always returned so modal can confirm without email
          email_sent: emailSent,
        }
      });
    } catch (err) { next(err); }
  }
);

// ---------------------------------------------------------------------------
// POST /api/users/:id/confirm-permanent-delete  — confirm & execute deletion
// ---------------------------------------------------------------------------
router.post(
  '/:id/confirm-permanent-delete',
  async (req, res, next) => {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Μόνο ο Super Admin.' });
    }
    try {
      const { id } = req.params;
      const { token } = req.body;

      if (!token) return res.status(400).json({ error: 'Token υποχρεωτικό.' });

      const [rows] = await pool.execute(
        "SELECT setting_value FROM platform_settings WHERE setting_key = ? LIMIT 1",
        [`delete_token_${id}`]
      );

      if (!rows.length) return res.status(400).json({ error: 'Δεν βρέθηκε αίτημα διαγραφής ή έχει λήξει.' });

      let stored;
      try { stored = JSON.parse(rows[0].setting_value); } catch { return res.status(400).json({ error: 'Άκυρο token.' }); }

      if (stored.token !== token) return res.status(400).json({ error: 'Λανθασμένο token επιβεβαίωσης.' });
      if (new Date() > new Date(stored.expires)) {
        await pool.execute("DELETE FROM platform_settings WHERE setting_key = ?", [`delete_token_${id}`]);
        return res.status(400).json({ error: 'Το token έχει λήξει. Ζητήστε νέο.' });
      }

      const [users] = await pool.execute('SELECT id, full_name, role FROM users WHERE id = ? LIMIT 1', [id]);
      if (!users.length) return res.status(404).json({ error: 'Χρήστης δεν βρέθηκε.' });
      if (users[0].role === 'super_admin') return res.status(403).json({ error: 'Δεν διαγράφεται Super Admin.' });

      // ── Execute permanent deletion (cascading order) ──────────────────────
      await pool.execute('DELETE FROM invoices WHERE created_by = ?', [id]);
      await pool.execute('DELETE FROM users WHERE id = ?', [id]);
      await pool.execute("DELETE FROM platform_settings WHERE setting_key = ?", [`delete_token_${id}`]);

      res.json({ data: { message: `Ο χρήστης ${users[0].full_name} διαγράφηκε μόνιμα.` } });
    } catch (err) { next(err); }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/users/me/fcm-token  — store FCM push notification token
// ---------------------------------------------------------------------------
router.patch('/me/fcm-token', async (req, res, next) => {
  try {
    const { fcm_token } = req.body;
    if (!fcm_token || typeof fcm_token !== 'string' || fcm_token.length < 10) {
      return res.status(400).json({ error: 'Μη έγκυρο FCM token.' });
    }
    await pool.execute(
      'UPDATE users SET fcm_token = ?, fcm_updated_at = NOW(), updated_at = NOW() WHERE id = ?',
      [fcm_token.trim(), req.user.id]
    );
    res.json({ data: { message: 'FCM token ενημερώθηκε.' } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// DELETE /api/users/me/fcm-token  — clear FCM token on logout
// ---------------------------------------------------------------------------
router.delete('/me/fcm-token', async (req, res, next) => {
  try {
    await pool.execute(
      'UPDATE users SET fcm_token = NULL, fcm_updated_at = NOW(), updated_at = NOW() WHERE id = ?',
      [req.user.id]
    );
    res.json({ data: { message: 'FCM token διαγράφηκε.' } });
  } catch (err) { next(err); }
});

module.exports = router;
