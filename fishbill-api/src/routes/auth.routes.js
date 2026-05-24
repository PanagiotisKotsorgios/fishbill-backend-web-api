const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const emailSvc = require('../services/email.service');

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const registerSchema = Joi.object({
  // Business fields
  business_name:    Joi.string().min(2).max(255).optional().allow('', null),
  business_afm:     Joi.string().min(1).max(20).required(),
  business_doy:     Joi.string().max(100).optional().allow('', null),
  business_address: Joi.string().max(255).optional().allow('', null),
  business_city:    Joi.string().max(100).optional().allow('', null),
  business_phone:   Joi.string().max(30).optional().allow('', null),
  business_email:   Joi.string().email().optional().allow('', null),
  // Fishing license — required to prove registrant is a fisherman
  fishing_license:          Joi.string().min(3).max(60).required(),
  // Self-declaration as fisherman per Ν. 1599/1986 (optional for API compat, enforced by UI)
  self_declared_fisherman:  Joi.boolean().optional(),
  // Owner user fields
  owner_name:       Joi.string().min(2).max(255).required(),
  owner_email:      Joi.string().email().required(),
  owner_password:   Joi.string().min(8).required(),
});

// Greek AFM checksum validation (standard MOD-11 variant)
function isValidGreekAfm(afm) {
  if (!/^\d{9}$/.test(afm) || afm === '000000000') return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += parseInt(afm[i]) * Math.pow(2, 8 - i);
  const check = sum % 11;
  return (check === 10 ? 0 : check) === parseInt(afm[8]);
}

const refreshSchema = Joi.object({
  refresh_token: Joi.string().required(),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  password: Joi.string().min(8).required(),
});

// ---------------------------------------------------------------------------
// Helper: sign tokens
// ---------------------------------------------------------------------------
function signTokens(user) {
  const payload = {
    id: user.id,
    business_id: user.business_id,
    role: user.role,
    full_name: user.full_name || null,
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });

  return { accessToken, refreshToken };
}

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const [rows] = await pool.execute(
      `SELECT u.id, u.business_id, u.role, u.password_hash, u.is_active, u.full_name,
              u.email, u.avatar_url, u.email_verified,
              b.is_suspended, b.name AS business_name, b.afm AS business_afm
       FROM users u
       LEFT JOIN businesses b ON b.id = u.business_id
       WHERE u.email = ? LIMIT 1`,
      [email]
    );

    const ipAddress = req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;

    if (!rows.length) {
      // Log failed attempt (unknown email)
      pool.execute(
        `INSERT INTO audit_logs (user_id, business_id, action, entity_type, description, ip_address, created_at)
         VALUES (NULL, NULL, 'LOGIN_FAILED', 'user', ?, ?, NOW())`,
        [`Failed login attempt for unknown email: ${email}`, ipAddress]
      ).catch(() => {});
      return res.status(401).json({ error: 'Λάθος email ή κωδικός.' });
    }

    const user = rows[0];

    if (!user.is_active) {
      pool.execute(
        `INSERT INTO audit_logs (user_id, business_id, action, entity_type, entity_id, description, ip_address, created_at)
         VALUES (?, ?, 'LOGIN_FAILED', 'user', ?, ?, ?, NOW())`,
        [user.id, user.business_id, user.id, `Login blocked - account deactivated: ${email}`, ipAddress]
      ).catch(() => {});
      return res.status(403).json({ error: 'Ο λογαριασμός δεν είναι ενεργός.' });
    }

    if (user.is_suspended) {
      pool.execute(
        `INSERT INTO audit_logs (user_id, business_id, action, entity_type, entity_id, description, ip_address, created_at)
         VALUES (?, ?, 'LOGIN_FAILED', 'user', ?, ?, ?, NOW())`,
        [user.id, user.business_id, user.id, `Login blocked - business suspended: ${email}`, ipAddress]
      ).catch(() => {});
      return res.status(403).json({ error: 'Ο λογαριασμός της επιχείρησης έχει ανασταλεί.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      pool.execute(
        `INSERT INTO audit_logs (user_id, business_id, action, entity_type, entity_id, description, ip_address, created_at)
         VALUES (?, ?, 'LOGIN_FAILED', 'user', ?, ?, ?, NOW())`,
        [user.id, user.business_id, user.id, `Wrong password for: ${email}`, ipAddress]
      ).catch(() => {});
      return res.status(401).json({ error: 'Λάθος email ή κωδικός.' });
    }

    // Only fisherman roles (owner, employee) may use this endpoint
    const FISHERMAN_ROLES = ['owner', 'employee'];
    if (!FISHERMAN_ROLES.includes(user.role)) {
      pool.execute(
        `INSERT INTO audit_logs (user_id, business_id, action, entity_type, entity_id, description, ip_address, created_at)
         VALUES (?, ?, 'LOGIN_BLOCKED', 'user', ?, ?, ?, NOW())`,
        [user.id, user.business_id, user.id, `Non-fisherman role "${user.role}" blocked on fisherman login endpoint: ${email}`, ipAddress]
      ).catch(() => {});
      return res.status(401).json({ error: 'Λάθος email ή κωδικός.' });
    }

    // Update last_login
    await pool.execute('UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?', [ipAddress, user.id]);

    // Log successful login
    pool.execute(
      `INSERT INTO audit_logs (user_id, business_id, action, entity_type, entity_id, description, ip_address, created_at)
       VALUES (?, ?, 'LOGIN_SUCCESS', 'user', ?, ?, ?, NOW())`,
      [user.id, user.business_id, user.id, `Successful login: ${email}`, ipAddress]
    ).catch(() => {});

    const { accessToken, refreshToken } = signTokens(user);

    res.json({
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: process.env.JWT_EXPIRES_IN || '7d',
        user: {
          id: user.id,
          name: user.full_name,
          role: user.role,
          business_id: user.business_id,
          business_name: user.business_name,
          email: user.email,
          business_afm: user.business_afm,
          avatar_url: user.avatar_url || null,
          email_verified: !!user.email_verified,
        },
      },
    });

  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/verify-email/:token
// ---------------------------------------------------------------------------
router.get('/verify-email/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    const [rows] = await pool.execute(
      `SELECT id, email_verify_expires FROM users
       WHERE email_verify_token = ? AND email_verified = 0 LIMIT 1`,
      [token]
    );
    if (!rows.length) {
      return res.status(400).send('<h2>Ο σύνδεσμος επιβεβαίωσης είναι άκυρος ή έχει ήδη χρησιμοποιηθεί.</h2>');
    }
    if (new Date() > new Date(rows[0].email_verify_expires)) {
      return res.status(400).send('<h2>Ο σύνδεσμος επιβεβαίωσης έχει λήξει. Παρακαλώ ζητήστε νέο από την εφαρμογή.</h2>');
    }
    await pool.execute(
      `UPDATE users SET email_verified = 1, email_verify_token = NULL, email_verify_expires = NULL, updated_at = NOW() WHERE id = ?`,
      [rows[0].id]
    );
    res.send(`<!DOCTYPE html>
<html lang="el">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Email Επιβεβαιώθηκε — FishBill</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Inter, system-ui, sans-serif; background: linear-gradient(135deg, #064050, #0A5568);
           min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #fff; border-radius: 24px; padding: 44px 36px; text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,.25); max-width: 380px; width: 100%; }
    .icon { font-size: 64px; margin-bottom: 16px; }
    h1 { color: #0A5568; font-size: 24px; font-weight: 800; margin-bottom: 10px; }
    p  { color: #4b5563; font-size: 15px; line-height: 1.6; margin-bottom: 8px; }
    .btn { display: inline-flex; align-items: center; gap: 8px; margin-top: 24px;
           background: #0A5568; color: #fff; font-weight: 700; font-size: 16px;
           padding: 14px 32px; border-radius: 14px; text-decoration: none;
           transition: background .2s; }
    .btn:hover { background: #064050; }
    .hint { margin-top: 16px; font-size: 12px; color: #9ca3af; }
  </style>
  <script>
    // Immediately try to open the app via deep link
    window.onload = function() {
      window.location.href = 'fishbill://email-verified';
      // Fallback: after 2 seconds the page stays visible with the open button
    };
  </script>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Email Επιβεβαιώθηκε!</h1>
    <p>Ο λογαριασμός σου στο FishBill είναι πλέον πλήρως ενεργοποιημένος.</p>
    <p>Η εφαρμογή θα ανοίξει αυτόματα.</p>
    <a href="fishbill://email-verified" class="btn">🐟 Άνοιγμα FishBill</a>
    <p class="hint">Αν η εφαρμογή δεν ανοίξει αυτόματα, πάτησε το κουμπί.</p>
  </div>
</body>
</html>`);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/resend-verify  (authenticated)
// ---------------------------------------------------------------------------
router.post('/resend-verify', authenticate, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, full_name, email, email_verified FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ο χρήστης δεν βρέθηκε.' });
    if (rows[0].email_verified) return res.json({ data: { message: 'Το email έχει ήδη επιβεβαιωθεί.' } });

    const verifyToken   = uuidv4();
    const verifyExpires = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await pool.execute(
      `UPDATE users SET email_verify_token = ?, email_verify_expires = ? WHERE id = ?`,
      [verifyToken, verifyExpires, req.user.id]
    );

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host     = req.headers['x-forwarded-host']  || req.get('host') || 'localhost';
    const baseUrl  = `${protocol}://${host}`;

    emailSvc.sendEmail({
      to: rows[0].email,
      toName: rows[0].full_name,
      subject: 'Επιβεβαιώστε το email σας — FishBill',
      html: `<div style="font-family:Inter,sans-serif;max-width:520px;margin:auto;padding:32px;background:#f9fafb;border-radius:16px">
        <h2 style="color:#0D47A1">🐟 Επιβεβαίωση Email</h2>
        <p style="color:#374151;margin:16px 0">Πάτησε τον παρακάτω σύνδεσμο για να επιβεβαιώσεις το email σου:</p>
        <div style="text-align:center;margin:24px 0">
          <a href="${baseUrl}/fishbill/fishbill-api/api/auth/verify-email/${verifyToken}"
             style="display:inline-block;background:#0D47A1;color:#fff;font-weight:700;font-size:16px;padding:14px 32px;border-radius:12px;text-decoration:none">
            Επιβεβαίωση Email
          </a>
        </div>
        <p style="color:#9ca3af;font-size:12px">Ο σύνδεσμος ισχύει 48 ώρες.</p>
      </div>`,
      _type: 'system',
    }).catch(err => { console.error('[resend-verify] email failed:', err.message); });

    res.json({ data: { message: 'Νέος σύνδεσμος επιβεβαίωσης εστάλη.' } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------
router.post('/register', validate(registerSchema), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const {
      business_afm, business_doy, business_address,
      business_city, business_phone, business_email,
      fishing_license,
      owner_name, owner_email, owner_password,
    } = req.body;
    // Use provided name or fall back to AFM so the field is never blank
    const business_name = (req.body.business_name || '').trim() || business_afm;

    // Check duplicate business AFM
    const [existingBiz] = await conn.execute(
      'SELECT id FROM businesses WHERE afm = ? LIMIT 1',
      [business_afm]
    );
    if (existingBiz.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Υπάρχει ήδη επιχείρηση με αυτό το ΑΦΜ.' });
    }

    // Check duplicate user email
    const [existingUser] = await conn.execute(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [owner_email]
    );
    if (existingUser.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Υπάρχει ήδη λογαριασμός με αυτό το email.' });
    }

    // Generate unique 6-digit fisherman code
    const fishermanCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Create business — no free trial; first paid month gets +1 month bonus (is_first_subscription flag)
    let bizInserted = false;
    try {
      await conn.execute(
        `INSERT INTO businesses
           (name, afm, doy, address, city, phone, email,
            plan, trial_ends_at, subscription_active, is_first_subscription,
            is_active, is_suspended, fisherman_code, fishing_license, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?,
                 'trial', NULL, 0, 1,
                 1, 0, ?, ?, NOW(), NOW())`,
        [business_name, business_afm, business_doy || null, business_address || null,
         business_city || null, business_phone || null, business_email || null,
         fishermanCode, fishing_license.trim()]
      );
      bizInserted = true;
    } catch (e) {
      if (!e.message.includes('fishing_license')) throw e;
      // Column not yet migrated — insert without it
      await conn.execute(
        `INSERT INTO businesses
           (name, afm, doy, address, city, phone, email,
            plan, trial_ends_at, subscription_active, is_first_subscription,
            is_active, is_suspended, fisherman_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?,
                 'trial', NULL, 0, 1,
                 1, 0, ?, NOW(), NOW())`,
        [business_name, business_afm, business_doy || null, business_address || null,
         business_city || null, business_phone || null, business_email || null, fishermanCode]
      );
      bizInserted = true;
    }
    // UUID PK: insertId returns 0, so fetch the generated UUID back
    const [[bizRow]] = await conn.execute(
      'SELECT id FROM businesses WHERE afm = ? LIMIT 1',
      [business_afm]
    );
    const businessId = bizRow.id;

    // Create default invoice series for this business
    await conn.execute(
      `INSERT INTO invoice_series (id, business_id, series, current_number, is_default, created_at)
       VALUES (UUID(), ?, 'A', 0, 1, NOW())`,
      [businessId]
    );

    // Hash password
    const passwordHash = await bcrypt.hash(owner_password, 12);

    // Generate email verification token
    const verifyToken   = uuidv4();
    const verifyExpires = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // Create owner user (email_verified = 1 — admin verifies manually by phone call)
    await conn.execute(
      `INSERT INTO users
         (id, business_id, full_name, email, password_hash, role, is_active,
          email_verified, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, 'owner', 1, 1, NOW(), NOW())`,
      [businessId, owner_name, owner_email, passwordHash]
    );

    // Fetch the newly created user's UUID (since we used UUID() in SQL)
    const [newUserRow] = await conn.execute(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [owner_email]
    );
    const userId = newUserRow[0].id;

    await conn.commit();

    // Fetch the created user for token signing
    const createdUser = { id: userId, business_id: businessId, role: 'owner', full_name: owner_name };
    const { accessToken, refreshToken } = signTokens(createdUser);

    // Send welcome email (non-blocking)
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host     = req.headers['x-forwarded-host']  || req.get('host') || 'localhost';
    const baseUrl  = `${protocol}://${host}`;
    emailSvc.sendWelcomeEmail({
      to: owner_email,
      toName: owner_name,
      businessName: business_name,
      baseUrl,
    }).catch(err => {
      console.error('[register] welcome email failed:', err.message);
    });

    // Notify admin of new business registration (non-blocking)
    emailSvc.sendNewBusinessRegistrationToAdmin({
      ownerName: owner_name,
      ownerEmail: owner_email,
      businessName: business_name,
      businessAfm: business_afm,
      city: business_city || null,
    }).catch(err => {
      console.error('[register] admin notification failed:', err.message);
    });

    res.status(201).json({
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        user: {
          id: userId,
          name: owner_name,
          role: 'owner',
          business_id: businessId,
          business_name,
          email_verified: false,
        },
      },
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------
router.post('/refresh', validate(refreshSchema), async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    let decoded;
    try {
      decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Η σύνδεσή σας έληξε. Συνδεθείτε ξανά.' });
    }

    // Verify user still exists and is active
    const [rows] = await pool.execute(
      'SELECT id, business_id, role, is_active FROM users WHERE id = ? LIMIT 1',
      [decoded.id]
    );

    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ error: 'Ο χρήστης δεν βρέθηκε ή δεν είναι ενεργός.' });
    }

    const user = rows[0];
    const { accessToken, refreshToken } = signTokens(user);

    res.json({
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: process.env.JWT_EXPIRES_IN || '7d',
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
router.post('/logout', authenticate, (req, res) => {
  // JWT is stateless; client must discard the token.
  res.json({ data: { message: 'Αποσυνδεθήκατε.' } });
});

// ---------------------------------------------------------------------------
// POST /api/auth/change-password   (authenticated, self-service)
// ---------------------------------------------------------------------------
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Απαιτούνται τρέχων και νέος κωδικός.' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Ο νέος κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.' });
    }

    const [rows] = await pool.execute(
      'SELECT id, password_hash FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
      [req.user.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Ο χρήστης δεν βρέθηκε.' });
    }

    const valid = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!valid) {
      return res.status(400).json({ error: 'Λάθος τρέχων κωδικός.' });
    }

    const passwordHash = await bcrypt.hash(new_password, 12);
    await pool.execute(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL, updated_at = NOW() WHERE id = ?',
      [passwordHash, req.user.id]
    );

    res.json({ data: { message: 'Ο κωδικός άλλαξε επιτυχώς.' } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/auth/me   (authenticated, self-deactivate)
// ---------------------------------------------------------------------------
router.delete('/me', authenticate, async (req, res, next) => {
  try {
    await pool.execute(
      'UPDATE users SET is_active = 0, updated_at = NOW() WHERE id = ?',
      [req.user.id]
    );
    res.json({ data: { message: 'Ο λογαριασμός απενεργοποιήθηκε.' } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/delete-request   (authenticated — sends email to admin)
// ---------------------------------------------------------------------------
router.post('/delete-request', authenticate, async (req, res, next) => {
  try {
    const user = req.user;
    const [rows] = await pool.execute(
      'SELECT email, full_name FROM users WHERE id = ? LIMIT 1',
      [user.id]
    );
    const u = rows[0];
    const cfg = await emailSvc.loadConfig();
    const adminEmail = cfg.admin_notification_email || process.env.ADMIN_EMAIL || 'admin@fishbill.gr';

    // Log the request to the database for auditing
    await pool.execute(
      `INSERT IGNORE INTO audit_log (user_id, action, detail, created_at)
       VALUES (?, 'delete_request', ?, NOW())
       ON DUPLICATE KEY UPDATE created_at = NOW()`,
      [user.id, JSON.stringify({ email: u?.email, name: u?.full_name, business_id: user.business_id })]
    ).catch(() => {}); // non-fatal

    // Send email to admin (best-effort — don't fail the request if email not configured)
    try {
      await emailSvc.sendAdminActionEmail({
        adminEmail,
        action  : 'delete_request',
        subject : `Αίτηση Διαγραφής Λογαριασμού — ${u?.full_name || u?.email || user.id}`,
        bodyHtml: `
          <p>Ένας χρήστης ζήτησε τη <strong>διαγραφή του λογαριασμού</strong> του από την εφαρμογή FishBill.</p>
          <table style="border-collapse:collapse;width:100%">
            <tr><td style="padding:6px 12px;font-weight:bold">Όνομα</td><td>${u?.full_name || '—'}</td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold">Email</td><td>${u?.email || '—'}</td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold">User ID</td><td>${user.id}</td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold">Business ID</td><td>${user.business_id || '—'}</td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold">Ημερομηνία</td><td>${new Date().toLocaleString('el-GR')}</td></tr>
          </table>
          <p style="margin-top:16px">Παρακαλώ επικοινωνήστε με τον χρήστη και προχωρήστε σε διαγραφή εφόσον το επιβεβαιώσει.</p>
        `,
      });
    } catch (emailErr) {
      console.warn('[delete-request] email not sent:', emailErr.message);
    }

    res.json({ data: { message: 'Το αίτημα διαγραφής εστάλη στον διαχειριστή.' } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password
// ---------------------------------------------------------------------------
router.post('/forgot-password', validate(forgotPasswordSchema), async (req, res, next) => {
  try {
    const { email } = req.body;

    const [rows] = await pool.execute(
      'SELECT id, full_name, role FROM users WHERE email = ? AND is_active = 1 LIMIT 1',
      [email]
    );

    // Always return the same message to prevent email enumeration.
    const notFoundResponse = { data: { message: 'Αν το email υπάρχει στο σύστημα, θα λάβετε σύνδεσμο επαναφοράς.' } };

    if (!rows.length) return res.json(notFoundResponse);

    const user = rows[0];
    const resetToken = uuidv4();

    // FROM_UNIXTIME(UNIX_TIMESTAMP() + 3600) is timezone-agnostic: works regardless
    // of mysql2's timezone setting or MySQL server timezone.
    await pool.execute(
      'UPDATE users SET reset_token = ?, reset_token_expires = FROM_UNIXTIME(UNIX_TIMESTAMP() + 3600) WHERE id = ?',
      [resetToken, user.id]
    );

    // Use web_base_url from platform_settings for the browser fallback link.
    // This is the web-server URL (Apache/nginx), NOT the API URL.
    // e.g. http://192.168.1.4/fishbill  or  https://fishbill.gr/fishbill
    let baseUrl;
    try {
      const [cfgRows] = await pool.execute(
        "SELECT setting_value FROM platform_settings WHERE setting_key = 'web_base_url' LIMIT 1"
      );
      const webUrl = cfgRows[0]?.setting_value;
      if (webUrl) {
        // Strip trailing slash — email.service.js will append /fishbill/reset-password.html
        baseUrl = webUrl.replace(/\/$/, '');
      } else {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host     = req.headers['x-forwarded-host']  || req.get('host') || 'localhost';
        baseUrl = `${protocol}://${host}/fishbill`;
      }
    } catch {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const host     = req.headers['x-forwarded-host']  || req.get('host') || 'localhost';
      baseUrl = `${protocol}://${host}/fishbill`;
    }

    const isAccountant = user.role === 'accountant';

    // Send email (non-blocking — don't fail request on email error)
    emailSvc.sendPasswordResetEmail({
      to:          email,
      toName:      user.full_name,
      resetToken,
      baseUrl,
      isAccountant,
    }).catch(err => {
      console.error('[forgot-password] email send failed:', err.message);
    });

    res.json({
      data: {
        message: 'Αν το email υπάρχει στο σύστημα, θα λάβετε σύνδεσμο επαναφοράς.',
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/reset-password
// ---------------------------------------------------------------------------
router.post('/reset-password', validate(resetPasswordSchema), async (req, res, next) => {
  try {
    const { token, password } = req.body;

    const [rows] = await pool.execute(
      `SELECT id FROM users
       WHERE reset_token = ? AND UNIX_TIMESTAMP(reset_token_expires) > UNIX_TIMESTAMP() AND is_active = 1 LIMIT 1`,
      [token]
    );

    if (!rows.length) {
      return res.status(400).json({ error: 'Ο σύνδεσμος έχει λήξει ή δεν είναι σωστός.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await pool.execute(
      `UPDATE users
       SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL, updated_at = NOW()
       WHERE id = ?`,
      [passwordHash, rows[0].id]
    );

    res.json({ data: { message: 'Ο κωδικός άλλαξε. Συνδεθείτε με τον νέο κωδικό.' } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/owner-recovery
// Step 1: owner proves identity with email + business AFM → get OTP by email
// This is the emergency recovery path when account access is compromised.
// ---------------------------------------------------------------------------
router.post('/owner-recovery', async (req, res, next) => {
  try {
    const { email, business_afm } = req.body;
    if (!email || !business_afm) {
      return res.status(400).json({ error: 'email και business_afm απαιτούνται.' });
    }

    // Find owner user whose business AFM matches — only role='owner' can use this
    const [rows] = await pool.execute(
      `SELECT u.id, u.email, u.full_name, u.is_active, b.afm AS biz_afm, b.name AS biz_name
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       WHERE u.email = ? AND u.role = 'owner' AND b.afm = ?
       LIMIT 1`,
      [email.toLowerCase().trim(), business_afm.trim()]
    );

    // Always respond success to avoid email enumeration
    if (!rows.length || !rows[0].is_active) {
      return res.json({ data: { message: 'Αν τα στοιχεία είναι σωστά, θα λάβετε email με κωδικό ανάκτησης.' } });
    }

    const owner = rows[0];

    // Generate a 32-char hex recovery token (more secure than 6-digit OTP for this use case)
    const crypto = require('crypto');
    const recoveryToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    const otpKey = `owner_recovery_${owner.id}`;
    await pool.execute(
      `INSERT INTO platform_settings (setting_key, setting_value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()`,
      [
        otpKey,
        JSON.stringify({ token: recoveryToken, expires: expiresAt.toISOString() }),
        JSON.stringify({ token: recoveryToken, expires: expiresAt.toISOString() }),
      ]
    );

    // Email the recovery token
    const emailCfg = await emailSvc.loadConfig();
    const webBaseUrl = (emailCfg.web_base_url || process.env.APP_BASE_URL || '').replace(/\/$/, '');
    const recoveryUrl = `${webBaseUrl}/app/recovery-login.html?token=${recoveryToken}&uid=${encodeURIComponent(owner.id)}`;
    const safeEmail   = emailSvc.escHtml(owner.email);
    const safeBizName = emailSvc.escHtml(owner.biz_name);
    try {
      await emailSvc.sendEmail({
        to: owner.email,
        toName: owner.full_name,
        subject: '[FishBill] Κωδικός Ανάκτησης Πρόσβασης (15 λεπτά)',
        html: `<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;padding:32px;background:#f0f7f9">
          <div style="max-width:520px;margin:auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(11,114,133,.12)">
            <h2 style="color:#0A5568;margin-bottom:8px">🔐 Ανάκτηση Πρόσβασης FishBill</h2>
            <p style="color:#374151">Ζητήθηκε ανάκτηση πρόσβασης για τον λογαριασμό <strong>${safeEmail}</strong> της επιχείρησης <strong>${safeBizName}</strong>.</p>
            <p style="color:#374151">Πατήστε τον παρακάτω σύνδεσμο για να αποκτήσετε ξανά πρόσβαση:</p>
            <div style="text-align:center;margin:28px 0">
              <a href="${recoveryUrl}" style="display:inline-block;background:#0A5568;color:#fff;text-decoration:none;border-radius:12px;padding:16px 32px;font-size:16px;font-weight:700">
                Ανάκτηση Πρόσβασης →
              </a>
            </div>
            <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:10px;padding:14px 16px;margin-bottom:16px">
              <p style="margin:0;font-size:13px;color:#92400e">
                <strong>⏱ Ο σύνδεσμος λήγει σε 15 λεπτά.</strong><br/>
                Αν ΔΕΝ εσύ έκανες αυτήν την ενέργεια, αγνόησε αυτό το email — ο λογαριασμός σου παραμένει ασφαλής.
              </p>
            </div>
            <p style="font-size:12px;color:#9ca3af">Μετά την είσοδο, αλλάξτε άμεσα τον κωδικό σας από τις ρυθμίσεις προφίλ.</p>
          </div>
        </body></html>`,
      });
    } catch (emailErr) {
      console.error('[owner-recovery] email error:', emailErr.message);
    }

    res.json({ data: { message: 'Αν τα στοιχεία είναι σωστά, θα λάβετε email με κωδικό ανάκτησης.' } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/owner-recovery-login
// Step 2: exchange the recovery token for a JWT session
// ---------------------------------------------------------------------------
router.post('/owner-recovery-login', async (req, res, next) => {
  try {
    const { token, uid } = req.body;
    if (!token || !uid) {
      return res.status(400).json({ error: 'token και uid απαιτούνται.' });
    }

    const otpKey = `owner_recovery_${uid}`;
    const [rows] = await pool.execute(
      'SELECT setting_value FROM platform_settings WHERE setting_key = ? LIMIT 1',
      [otpKey]
    );

    if (!rows.length) {
      return res.status(400).json({ error: 'Ο σύνδεσμος ανάκτησης δεν βρέθηκε ή έχει ήδη χρησιμοποιηθεί.' });
    }

    let stored;
    try { stored = JSON.parse(rows[0].setting_value); }
    catch { return res.status(400).json({ error: 'Άκυρο token.' }); }

    if (new Date() > new Date(stored.expires)) {
      await pool.execute('DELETE FROM platform_settings WHERE setting_key = ?', [otpKey]);
      return res.status(400).json({ error: 'Ο σύνδεσμος ανάκτησης έχει λήξει. Ξεκινήστε ξανά.' });
    }

    if (stored.token !== token) {
      return res.status(400).json({ error: 'Άκυρο token ανάκτησης.' });
    }

    // Fetch the owner user
    const [userRows] = await pool.execute(
      `SELECT u.id, u.business_id, u.role, u.full_name, u.email, u.avatar_url,
              b.name AS business_name, b.afm AS business_afm
       FROM users u
       LEFT JOIN businesses b ON b.id = u.business_id
       WHERE u.id = ? AND u.role = 'owner' AND u.is_active = 1 LIMIT 1`,
      [uid]
    );

    if (!userRows.length) {
      return res.status(400).json({ error: 'Ο χρήστης δεν βρέθηκε.' });
    }

    // Consume token immediately — single use
    await pool.execute('DELETE FROM platform_settings WHERE setting_key = ?', [otpKey]);

    const user = userRows[0];
    const { accessToken, refreshToken } = signTokens(user);

    res.json({
      data: {
        token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          business_id: user.business_id,
          role: user.role,
          full_name: user.full_name,
          email: user.email,
          avatar_url: user.avatar_url,
          business_name: user.business_name,
        },
        message: 'Ανάκτηση πρόσβασης επιτυχής. Αλλάξτε τον κωδικό σας άμεσα.',
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/admin-login  (super_admin only)
// Separate endpoint so the fisherman login check does not block platform admins.
// ---------------------------------------------------------------------------
router.post('/admin-login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const ipAddress = req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;

    const [rows] = await pool.execute(
      `SELECT u.id, u.business_id, u.role, u.password_hash, u.is_active, u.full_name, u.email
       FROM users u
       WHERE u.email = ? LIMIT 1`,
      [email]
    );

    const fail = (msg = 'Λάθος email ή κωδικός.') => {
      pool.execute(
        `INSERT INTO audit_logs (user_id, business_id, action, entity_type, description, ip_address, created_at)
         VALUES (NULL, NULL, 'ADMIN_LOGIN_FAILED', 'user', ?, ?, NOW())`,
        [msg + ' email=' + email, ipAddress]
      ).catch(() => {});
      return res.status(401).json({ error: 'Λάθος email ή κωδικός.' });
    };

    if (!rows.length) return fail();

    const user = rows[0];

    if (!user.is_active) return fail('Account deactivated.');

    if (user.role !== 'super_admin') {
      pool.execute(
        `INSERT INTO audit_logs (user_id, business_id, action, entity_type, entity_id, description, ip_address, created_at)
         VALUES (?, ?, 'ADMIN_LOGIN_BLOCKED', 'user', ?, ?, ?, NOW())`,
        [user.id, user.business_id, user.id, `Non-admin role "${user.role}" blocked on admin login: ${email}`, ipAddress]
      ).catch(() => {});
      return res.status(403).json({ error: 'Αυτή η πύλη είναι αποκλειστικά για διαχειριστές συστήματος.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return fail('Λάθος κωδικός.');

    await pool.execute('UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?', [ipAddress, user.id]);

    pool.execute(
      `INSERT INTO audit_logs (user_id, business_id, action, entity_type, entity_id, description, ip_address, created_at)
       VALUES (?, NULL, 'ADMIN_LOGIN_SUCCESS', 'user', ?, ?, ?, NOW())`,
      [user.id, user.id, `Admin login: ${email}`, ipAddress]
    ).catch(() => {});

    const { accessToken, refreshToken } = signTokens(user);

    res.json({
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: process.env.JWT_EXPIRES_IN || '7d',
        user: {
          id: user.id,
          name: user.full_name,
          role: user.role,
          business_id: user.business_id || null,
          email: user.email,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
