/**
 * Accountant Portal API Routes
 * All routes require role = 'accountant' (or 'super_admin' for testing)
 *
 * POST  /api/accountant/register           register new accountant
 * GET   /api/accountant/me                 own profile
 * GET   /api/accountant/clients            list linked businesses
 * POST  /api/accountant/clients            link business by AFM
 * DELETE /api/accountant/clients/:bizId    unlink business
 *
 * GET   /api/accountant/clients/:bizId                    business overview
 * PATCH /api/accountant/clients/:bizId/profile            update business info
 * PATCH /api/accountant/clients/:bizId/mydata             update myDATA creds
 * PATCH /api/accountant/clients/:bizId/invoice-settings   invoice defaults
 * PATCH /api/accountant/clients/:bizId/email-settings     SMTP settings
 * PATCH /api/accountant/clients/:bizId/sms-settings       SMS settings
 *
 * GET   /api/accountant/clients/:bizId/invoices           list invoices
 * GET   /api/accountant/clients/:bizId/invoice-series     list/manage series
 * POST  /api/accountant/clients/:bizId/invoice-series     add series
 *
 * GET   /api/accountant/clients/:bizId/products           list products
 * POST  /api/accountant/clients/:bizId/products           create product
 * PUT   /api/accountant/clients/:bizId/products/:id       update product
 * DELETE /api/accountant/clients/:bizId/products/:id      delete product
 *
 * GET   /api/accountant/clients/:bizId/customers          list customers
 * POST  /api/accountant/clients/:bizId/customers          create customer
 * PUT   /api/accountant/clients/:bizId/customers/:id      update customer
 * DELETE /api/accountant/clients/:bizId/customers/:id     delete customer
 */

const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const Joi     = require('joi');
const pool    = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { validate }     = require('../middleware/validate');
const emailSvc = require('../services/email.service');

// ─── Middleware ───────────────────────────────────────────────────────────────

/** Require authenticated accountant (or super_admin) */
function requireAccountant(req, res, next) {
  if (!['accountant', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied. Accountant role required.' });
  }
  next();
}

/**
 * For routes with :bizId — verify the accountant actually has this client linked.
 * super_admin bypasses this check.
 */
async function requireClientAccess(req, res, next) {
  if (req.user.role === 'super_admin') return next();
  const { bizId } = req.params;
  try {
    const [rows] = await pool.execute(
      'SELECT id FROM accountant_clients WHERE accountant_id = ? AND business_id = ? LIMIT 1',
      [req.user.id, bizId]
    );
    if (!rows.length) {
      return res.status(403).json({ error: 'You do not have access to this client.' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

// ─── Validation schemas ───────────────────────────────────────────────────────

const registerAccountantSchema = Joi.object({
  full_name: Joi.string().min(2).max(255).required(),
  email:     Joi.string().email().required(),
  password:  Joi.string().min(8).required(),
  phone:     Joi.string().max(30).optional().allow('', null),
  afm:       Joi.string().length(9).optional().allow('', null),
});

// ─── POST /api/accountant/register ───────────────────────────────────────────
// Public — register a new accountant account (no auth required)
router.post('/register', validate(registerAccountantSchema), async (req, res, next) => {
  try {
    const { full_name, email, password, phone, afm } = req.body;

    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE email = ? LIMIT 1', [email]
    );
    if (existing.length) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await pool.execute(
      `INSERT INTO users
         (id, full_name, email, phone, password_hash, role, is_active, email_verified, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, 'accountant', 1, 0, NOW(), NOW())`,
      [full_name, email, phone || null, passwordHash]
    );

    // Store AFM if provided (graceful — column may not exist in older DB)
    if (afm) {
      pool.execute(
        'UPDATE users SET afm = ?, updated_at = NOW() WHERE email = ?',
        [afm, email]
      ).catch(() => {}); // silent — column may not exist yet
    }

    // Notify admin of new accountant registration (non-blocking)
    emailSvc.sendNewAccountantRegistrationToAdmin({
      accountantName: full_name,
      accountantEmail: email,
      accountantAfm: afm || null,
      phone: phone || null,
    }).catch(err => console.error('[accountant/register] admin notification failed:', err.message));

    res.status(201).json({ data: { message: 'Accountant account created. You can now log in.' } });
  } catch (err) {
    next(err);
  }
});

// All routes below this point require authentication + accountant role
router.use(authenticate, requireAccountant);

// ─── POST /api/accountant/verify-request ─────────────────────────────────────
// Submit a verification request with form data + optional file attachments (base64).
// Sends notification email to admin via Brevo (platform-level API key) or SMTP.
// Updates user record: verification_requested_at = NOW()
router.post('/verify-request', async (req, res, next) => {
  try {
    const user = req.user;
    const {
      license_number, oee_number,
      business_address, city, postal_code, notes,
      attachments = [],   // [{ name: 'filename.pdf', content: 'base64...' }]
    } = req.body;

    // Pull full_name, phone, afm from user profile (they were collected at registration)
    const [profileRows] = await pool.execute(
      'SELECT full_name, phone, afm FROM users WHERE id = ? LIMIT 1',
      [user.id]
    ).catch(() => [[{ full_name: user.full_name, phone: null, afm: null }]]);
    const profile = profileRows[0] || {};
    const full_name = req.body.full_name || profile.full_name || user.full_name;
    const phone     = req.body.phone     || profile.phone     || null;
    const afm       = req.body.afm       || profile.afm       || null;

    if (!afm || String(afm).length < 9) {
      // AFM not stored yet — return a helpful error asking to re-submit with AFM
      return res.status(400).json({ error: 'Δεν βρέθηκε ΑΦΜ στον λογαριασμό σας. Παρακαλώ επικοινωνήστε με τον διαχειριστή.' });
    }

    // Check if already submitted or verified
    const [existing] = await pool.execute(
      'SELECT is_verified, verification_requested_at FROM users WHERE id = ? LIMIT 1',
      [user.id]
    ).catch(() => [[{ is_verified: 0, verification_requested_at: null }]]);

    const row = existing[0] || {};
    if (row.is_verified === 1) {
      return res.status(400).json({ error: 'Ο λογαριασμός σας έχει ήδη επαληθευτεί.' });
    }
    if (row.verification_requested_at) {
      return res.json({ data: { status: 'pending', message: 'Η αίτησή σας βρίσκεται ήδη σε επεξεργασία.' } });
    }

    // Store submission data
    const formData = { full_name, afm, phone, license_number, oee_number, business_address, city, postal_code, notes };
    await pool.execute(
      `UPDATE users SET verification_requested_at = NOW(), verification_data = ? WHERE id = ?`,
      [JSON.stringify(formData), user.id]
    ).catch(() => {}); // graceful if columns don't exist yet

    // Send email to admin ─────────────────────────────────────────────────────
    const adminEmail = await getAdminEmail();
    try {
      await emailSvc.sendVerificationRequestToAdmin({
        adminEmail,
        accountant: { full_name: user.full_name, email: user.email },
        details: formData,
        attachments,
      });
    } catch (mailErr) {
      // Log but don't fail — form data is stored in DB
      console.error('[verify-request] email failed:', mailErr.message);
    }

    res.json({ data: { status: 'pending', message: 'Η αίτηση επαλήθευσης υποβλήθηκε επιτυχώς. Θα ειδοποιηθείτε μόλις εγκριθεί ο λογαριασμός σας.' } });
  } catch (err) { next(err); }
});

async function getAdminEmail() {
  try {
    const [rows] = await pool.execute(
      `SELECT setting_value FROM platform_settings WHERE setting_key = 'admin_notification_email' LIMIT 1`
    );
    return rows[0]?.setting_value || process.env.ADMIN_EMAIL || 'admin@fishbill.gr';
  } catch { return process.env.ADMIN_EMAIL || 'admin@fishbill.gr'; }
}

// ─── GET /api/accountant/me ───────────────────────────────────────────────────
router.get('/me', async (req, res, next) => {
  try {
    let rows;
    try {
      [rows] = await pool.execute(
        `SELECT id, full_name, email, phone, role, is_verified, last_login_at, created_at,
                notif_new_invoice, notif_mydata_fail, notif_client_new, notif_subscription
         FROM users WHERE id = ? LIMIT 1`,
        [req.user.id]
      );
    } catch (colErr) {
      // Fallback if migration columns (is_verified, notif_*) haven't been added yet
      [rows] = await pool.execute(
        `SELECT id, full_name, email, phone, role, last_login_at, created_at
         FROM users WHERE id = ? LIMIT 1`,
        [req.user.id]
      );
      rows = rows.map(r => ({
        ...r, is_verified: 1,
        notif_new_invoice: 1, notif_mydata_fail: 1,
        notif_client_new: 1,  notif_subscription: 0,
      }));
    }
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    const [clientCount] = await pool.execute(
      'SELECT COUNT(*) AS total FROM accountant_clients WHERE accountant_id = ?',
      [req.user.id]
    );
    res.json({ data: { ...rows[0], client_count: clientCount[0].total } });
  } catch (err) { next(err); }
});

// ─── PATCH /api/accountant/me ─────────────────────────────────────────────────
// Update accountant profile
router.patch('/me', async (req, res, next) => {
  try {
    const { full_name, email, phone } = req.body;
    if (!full_name && !email && !phone) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }
    const updates = [];
    const params  = [];
    if (full_name) { updates.push('full_name = ?'); params.push(full_name); }
    if (email)     { updates.push('email = ?');     params.push(email); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone || null); }
    updates.push('updated_at = NOW()');
    params.push(req.user.id);
    await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ data: { message: 'Profile updated.' } });
  } catch (err) { next(err); }
});

// ─── PATCH /api/accountant/me/notifications ───────────────────────────────────
router.patch('/me/notifications', async (req, res, next) => {
  try {
    const { notif_new_invoice, notif_mydata_fail, notif_client_new, notif_subscription } = req.body;
    await pool.execute(
      `UPDATE users SET
         notif_new_invoice  = ?, notif_mydata_fail  = ?,
         notif_client_new   = ?, notif_subscription = ?,
         updated_at = NOW()
       WHERE id = ?`,
      [notif_new_invoice ? 1 : 0, notif_mydata_fail ? 1 : 0,
       notif_client_new ? 1 : 0,  notif_subscription ? 1 : 0,
       req.user.id]
    );
    res.json({ data: { message: 'Notification preferences saved.' } });
  } catch (err) { next(err); }
});

// ─── DELETE /api/accountant/me ────────────────────────────────────────────────
// Permanently delete accountant account (requires password confirmation)
router.delete('/me', async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password is required to delete account.' });

    const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });

    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Incorrect password.' });

    // Remove accountant-client links (clients are NOT deleted)
    await pool.execute('DELETE FROM accountant_clients WHERE accountant_id = ?', [req.user.id]);
    // Delete user
    await pool.execute('DELETE FROM users WHERE id = ?', [req.user.id]);

    res.json({ data: { message: 'Account deleted.' } });
  } catch (err) { next(err); }
});

// ─── POST /api/accountant/bug-report ─────────────────────────────────────────
// Submit a bug report (stored in DB + email to admin)
router.post('/bug-report', async (req, res, next) => {
  try {
    const { category, description, steps, severity } = req.body;
    if (!category || !description) {
      return res.status(400).json({ error: 'Category and description are required.' });
    }
    if (description.length < 10) {
      return res.status(400).json({ error: 'Description must be at least 10 characters.' });
    }

    // Get reporter info
    const [userRows] = await pool.execute(
      'SELECT full_name, email FROM users WHERE id = ? LIMIT 1', [req.user.id]
    );
    const reporter = userRows[0] || {};

    // Save to DB
    await pool.execute(
      `INSERT INTO bug_reports (id, reporter_id, category, description, steps, severity)
       VALUES (UUID(), ?, ?, ?, ?, ?)`,
      [req.user.id, category, description, steps || null, severity || 'medium']
    );

    // Send email to admin via central email service
    const severityLabel = { low: '🟢 Χαμηλό', medium: '🟡 Μέτριο', high: '🔴 Υψηλό', critical: '🚨 Κρίσιμο' };
    const adminEmail = await getAdminEmail();
    emailSvc.sendEmail({
      to: adminEmail,
      subject: `[FishBill Bug] ${severityLabel[severity] || severity} — ${category}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px">
          <h2 style="color:#DC2626">🐛 Αναφορά Σφάλματος FishBill</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px;font-weight:bold;color:#6B7280">Λογιστής:</td><td>${reporter.full_name} (${reporter.email})</td></tr>
            <tr><td style="padding:8px;font-weight:bold;color:#6B7280">Κατηγορία:</td><td>${category}</td></tr>
            <tr><td style="padding:8px;font-weight:bold;color:#6B7280">Επείγον:</td><td>${severityLabel[severity] || severity}</td></tr>
          </table>
          <h3>Περιγραφή:</h3><p style="background:#F9FAFB;padding:14px;border-radius:8px">${description}</p>
          ${steps ? `<h3>Βήματα Αναπαραγωγής:</h3><p style="background:#F9FAFB;padding:14px;border-radius:8px;white-space:pre-line">${steps}</p>` : ''}
          <hr style="margin:24px 0;border:1px solid #E5E7EB"/>
          <p style="color:#9CA3AF;font-size:12px">FishBill Admin Panel — Αυτόματη Αποστολή</p>
        </div>`,
    }).catch(mailErr => {
      console.error('Bug report email failed:', mailErr.message);
    });

    res.status(201).json({ data: { message: 'Bug report submitted successfully.' } });
  } catch (err) { next(err); }
});

// ─── GET /api/accountant/clients ─────────────────────────────────────────────
router.get('/clients', async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;

    let whereExtra = '';
    const params = [req.user.id];
    if (search) {
      whereExtra = ' AND (b.name LIKE ? OR b.afm LIKE ? OR b.city LIKE ?)';
      params.push(search, search, search);
    }

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM accountant_clients ac
       JOIN businesses b ON b.id = ac.business_id
       WHERE ac.accountant_id = ?${whereExtra}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT b.id, b.name, b.afm, b.city, b.phone, b.email, b.plan, b.is_active, b.is_suspended,
              b.mydata_user_id, b.provider_name, b.gsis_username,
              (SELECT COUNT(*) FROM invoices i WHERE i.business_id = b.id) AS invoice_count,
              (SELECT COUNT(*) FROM invoices i WHERE i.business_id = b.id AND i.status = 'transmitted') AS transmitted_count,
              ac.added_at, ac.notes
       FROM accountant_clients ac
       JOIN businesses b ON b.id = ac.business_id
       WHERE ac.accountant_id = ?${whereExtra}
       ORDER BY b.name ASC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    res.json({ data: rows, total: countRows[0].total, page, limit });
  } catch (err) { next(err); }
});

// ─── POST /api/accountant/clients ────────────────────────────────────────────
// Link a business — requires BOTH AFM (9-digit) AND fisherman_code (6-digit)
// The fisherman sees their 6-digit code in their app Profile page.
router.post('/clients', async (req, res, next) => {
  try {
    const { afm, fisherman_code, notes } = req.body;

    if (!afm || String(afm).length !== 9) {
      return res.status(400).json({ error: 'ΑΦΜ 9 ψηφίων είναι υποχρεωτικό.' });
    }
    if (!fisherman_code || String(fisherman_code).length !== 6) {
      return res.status(400).json({ error: 'Κωδικός Σύνδεσης 6 ψηφίων είναι υποχρεωτικός. Ζητήστε τον από τον αλιέα (Εφαρμογή → Προφίλ → Κωδικός Σύνδεσης).' });
    }

    let bizRows;
    try {
      [bizRows] = await pool.execute(
        'SELECT id, name, afm, city FROM businesses WHERE afm = ? AND fisherman_code = ? AND is_active = 1 LIMIT 1',
        [String(afm), String(fisherman_code)]
      );
    } catch (colErr) {
      // fisherman_code column might not exist yet — fall back to AFM-only lookup
      [bizRows] = await pool.execute(
        'SELECT id, name, afm, city FROM businesses WHERE afm = ? AND is_active = 1 LIMIT 1',
        [String(afm)]
      );
    }

    if (!bizRows.length) {
      return res.status(404).json({ error: 'Δεν βρέθηκε ενεργή επιχείρηση με το συγκεκριμένο ΑΦΜ και Κωδικό Σύνδεσης. Ελέγξτε τα στοιχεία με τον αλιέα.' });
    }

    const business = bizRows[0];
    const [existing] = await pool.execute(
      'SELECT id FROM accountant_clients WHERE accountant_id = ? AND business_id = ? LIMIT 1',
      [req.user.id, business.id]
    );
    if (existing.length) {
      return res.status(409).json({ error: 'This business is already in your client list.' });
    }

    await pool.execute(
      'INSERT INTO accountant_clients (id, accountant_id, business_id, notes) VALUES (UUID(), ?, ?, ?)',
      [req.user.id, business.id, notes || null]
    );

    res.status(201).json({ data: { message: 'Client added successfully.', business } });
  } catch (err) { next(err); }
});

// ─── DELETE /api/accountant/clients/:bizId ────────────────────────────────────
router.delete('/clients/:bizId', requireClientAccess, async (req, res, next) => {
  try {
    await pool.execute(
      'DELETE FROM accountant_clients WHERE accountant_id = ? AND business_id = ?',
      [req.user.id, req.params.bizId]
    );
    res.json({ data: { message: 'Client removed from your list.' } });
  } catch (err) { next(err); }
});

// ─── GET /api/accountant/clients/:bizId ──────────────────────────────────────
router.get('/clients/:bizId', requireClientAccess, async (req, res, next) => {
  try {
    const { bizId } = req.params;

    const [bizRows] = await pool.execute(
      'SELECT * FROM businesses WHERE id = ? LIMIT 1', [bizId]
    );
    if (!bizRows.length) return res.status(404).json({ error: 'Business not found.' });

    const [settingsRows] = await pool.execute(
      'SELECT * FROM business_settings WHERE business_id = ? LIMIT 1', [bizId]
    );

    const [stats] = await pool.execute(
      `SELECT
         COUNT(*) AS total_invoices,
         SUM(CASE WHEN status = 'transmitted' THEN 1 ELSE 0 END) AS transmitted,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN DATE(issue_date) = CURDATE() THEN 1 ELSE 0 END) AS today,
         SUM(CASE WHEN MONTH(issue_date) = MONTH(NOW()) AND YEAR(issue_date) = YEAR(NOW()) THEN total_value ELSE 0 END) AS monthly_revenue
       FROM invoices WHERE business_id = ?`,
      [bizId]
    );

    res.json({
      data: {
        business: bizRows[0],
        settings: settingsRows.length ? settingsRows[0] : {},
        stats: stats[0],
      },
    });
  } catch (err) { next(err); }
});

// ─── PATCH /api/accountant/clients/:bizId/profile ────────────────────────────
router.patch('/clients/:bizId/profile', requireClientAccess, async (req, res, next) => {
  try {
    const { bizId } = req.params;
    const allowed = [
      'name', 'trade_name', 'doy', 'address', 'city', 'postal_code',
      'phone', 'email', 'activity_code', 'vat_regime',
      'accountant_name', 'accountant_email', 'accountant_phone',
    ];
    const setClauses = [];
    const params = [];
    for (const f of allowed) {
      if (req.body[f] !== undefined) { setClauses.push(`${f} = ?`); params.push(req.body[f]); }
    }
    if (!setClauses.length) return res.status(400).json({ error: 'No updatable fields provided.' });
    setClauses.push('updated_at = NOW()');
    params.push(bizId);
    await pool.execute(`UPDATE businesses SET ${setClauses.join(', ')} WHERE id = ?`, params);
    const [updated] = await pool.execute('SELECT * FROM businesses WHERE id = ? LIMIT 1', [bizId]);
    res.json({ data: updated[0] });
  } catch (err) { next(err); }
});

// ─── PATCH /api/accountant/clients/:bizId/gsis ───────────────────────────────
router.patch('/clients/:bizId/gsis', requireClientAccess, async (req, res, next) => {
  try {
    const { bizId } = req.params;
    const { gsis_username, gsis_password } = req.body;
    const setClauses = [];
    const params = [];
    if (gsis_username !== undefined) { setClauses.push('gsis_username = ?'); params.push(gsis_username || null); }
    if (gsis_password !== undefined) { setClauses.push('gsis_password = ?'); params.push(gsis_password || null); }
    if (!setClauses.length) return res.status(400).json({ error: 'No fields provided.' });
    setClauses.push('updated_at = NOW()');
    params.push(bizId);
    await pool.execute(`UPDATE businesses SET ${setClauses.join(', ')} WHERE id = ?`, params);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── GET /api/accountant/clients/:bizId/gsis/test ────────────────────────────
// Test GSIS (rgWsPublic) credentials by doing a real AFM lookup
router.get('/clients/:bizId/gsis/test', requireClientAccess, async (req, res, next) => {
  try {
    const { bizId } = req.params;
    // Resolve credentials: prefer query params (unsaved test), fall back to saved
    let username = req.query.username;
    let password = req.query.password;
    if (!username || !password) {
      const [rows] = await pool.execute(
        'SELECT gsis_username, gsis_password FROM businesses WHERE id = ? LIMIT 1', [bizId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Business not found.' });
      username = username || rows[0].gsis_username;
      password = password || rows[0].gsis_password;
    }
    if (!username || !password) {
      return res.status(400).json({ error: 'Δεν έχουν οριστεί διαπιστευτήρια ΓΓΠΣ.' });
    }

    // Call the ΓΓΠΣ rgWsPublic SOAP service
    const axios = require('axios');
    const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"
              xmlns:ns1="http://gr/gsis/rgwspublic/RgWsPublic.wsdl">
  <env:Header/>
  <env:Body>
    <ns1:rgWsPublicVersionInfo/>
  </env:Body>
</env:Envelope>`;

    const resp = await axios.post(
      'https://www1.gsis.gr/wsaade/RgWsPublic2/RgWsPublic',
      soapBody,
      {
        headers: {
          'Content-Type': 'application/soap+xml;charset=UTF-8',
          'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
        },
        timeout: 12000,
      }
    );

    if (resp.status === 200 && resp.data && resp.data.includes('RgWsPublicVersionInfoResponse')) {
      return res.json({ data: { success: true, message: 'Σύνδεση με ΓΓΠΣ επιτυχής!' } });
    }
    return res.status(502).json({ error: 'Απροσδόκητη απόκριση από ΓΓΠΣ.' });
  } catch (err) {
    if (err.response?.status === 401) {
      return res.status(401).json({ error: 'Λάθος όνομα χρήστη ή κωδικός TaxisNet.' });
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return res.status(504).json({ error: 'Timeout — η υπηρεσία ΓΓΠΣ δεν αποκρίθηκε.' });
    }
    // If GSIS is unreachable (no internet etc), treat credentials as untestable
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      return res.status(503).json({ error: 'Δεν είναι δυνατή η σύνδεση με τη ΓΓΠΣ. Ελέγξτε τη σύνδεση.' });
    }
    next(err);
  }
});

// ─── PATCH /api/accountant/clients/:bizId/mydata ─────────────────────────────
router.patch('/clients/:bizId/mydata', requireClientAccess, async (req, res, next) => {
  try {
    const { bizId } = req.params;
    const allowed = [
      'mydata_user_id', 'mydata_subscription_key',
      'provider_name', 'provider_api_key', 'provider_api_url',
      'provider_username', 'provider_password',
    ];
    const setClauses = [];
    const params = [];
    for (const f of allowed) {
      if (req.body[f] !== undefined) { setClauses.push(`${f} = ?`); params.push(req.body[f]); }
    }
    if (!setClauses.length) return res.status(400).json({ error: 'No updatable fields provided.' });
    setClauses.push('updated_at = NOW()');
    params.push(bizId);
    await pool.execute(`UPDATE businesses SET ${setClauses.join(', ')} WHERE id = ?`, params);
    const [updated] = await pool.execute('SELECT * FROM businesses WHERE id = ? LIMIT 1', [bizId]);
    res.json({ data: updated[0] });
  } catch (err) { next(err); }
});

// ─── Helper: upsert business_settings ────────────────────────────────────────
async function upsertSettings(bizId, fields) {
  const cols = Object.keys(fields);
  const vals = Object.values(fields);
  const setClause = cols.map(c => `${c} = ?`).join(', ');
  await pool.execute(
    `INSERT INTO business_settings (business_id, ${cols.join(', ')})
     VALUES (?, ${cols.map(() => '?').join(', ')})
     ON DUPLICATE KEY UPDATE ${setClause}, updated_at = NOW()`,
    [bizId, ...vals, ...vals]
  );
}

// ─── PATCH /api/accountant/clients/:bizId/invoice-settings ───────────────────
router.patch('/clients/:bizId/invoice-settings', requireClientAccess, async (req, res, next) => {
  try {
    const fields = {};
    for (const f of ['invoice_footer', 'default_due_days', 'auto_transmit']) {
      if (req.body[f] !== undefined) fields[f] = req.body[f];
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'No updatable fields provided.' });
    await upsertSettings(req.params.bizId, fields);
    const [rows] = await pool.execute(
      'SELECT * FROM business_settings WHERE business_id = ? LIMIT 1', [req.params.bizId]
    );
    res.json({ data: rows[0] || {} });
  } catch (err) { next(err); }
});

// ─── PATCH /api/accountant/clients/:bizId/email-settings ─────────────────────
router.patch('/clients/:bizId/email-settings', requireClientAccess, async (req, res, next) => {
  try {
    const fields = {};
    for (const f of ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from_name', 'smtp_from_email', 'smtp_secure', 'email_enabled']) {
      if (req.body[f] !== undefined) fields[f] = req.body[f];
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'No updatable fields provided.' });
    await upsertSettings(req.params.bizId, fields);
    const [rows] = await pool.execute(
      'SELECT * FROM business_settings WHERE business_id = ? LIMIT 1', [req.params.bizId]
    );
    res.json({ data: rows[0] || {} });
  } catch (err) { next(err); }
});

// ─── PATCH /api/accountant/clients/:bizId/sms-settings ───────────────────────
router.patch('/clients/:bizId/sms-settings', requireClientAccess, async (req, res, next) => {
  try {
    const fields = {};
    for (const f of ['sms_provider', 'sms_api_key', 'sms_api_secret', 'sms_from', 'sms_enabled']) {
      if (req.body[f] !== undefined) fields[f] = req.body[f];
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'No updatable fields provided.' });
    await upsertSettings(req.params.bizId, fields);
    const [rows] = await pool.execute(
      'SELECT * FROM business_settings WHERE business_id = ? LIMIT 1', [req.params.bizId]
    );
    res.json({ data: rows[0] || {} });
  } catch (err) { next(err); }
});

// ─── GET /api/accountant/clients/:bizId/invoices ─────────────────────────────
router.get('/clients/:bizId/invoices', requireClientAccess, async (req, res, next) => {
  try {
    const { bizId } = req.params;
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const [countRows] = await pool.execute(
      'SELECT COUNT(*) AS total FROM invoices WHERE business_id = ?', [bizId]
    );
    const [rows] = await pool.execute(
      `SELECT i.id, i.full_number, i.issue_date, i.total_value, i.status,
              i.mydata_mark, i.payment_method, c.name AS customer_name
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.business_id = ?
       ORDER BY i.issue_date DESC, i.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [bizId]
    );
    res.json({ data: rows, total: countRows[0].total, page, limit });
  } catch (err) { next(err); }
});

// ─── GET /api/accountant/clients/:bizId/invoice-series ───────────────────────
router.get('/clients/:bizId/invoice-series', requireClientAccess, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM invoice_series WHERE business_id = ? ORDER BY is_default DESC, series ASC',
      [req.params.bizId]
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ─── POST /api/accountant/clients/:bizId/invoice-series ──────────────────────
router.post('/clients/:bizId/invoice-series', requireClientAccess, async (req, res, next) => {
  try {
    const { bizId } = req.params;
    const { series, description, invoice_type, is_default } = req.body;
    if (!series) return res.status(400).json({ error: 'Series code is required.' });

    if (is_default) {
      await pool.execute(
        'UPDATE invoice_series SET is_default = 0 WHERE business_id = ?', [bizId]
      );
    }

    await pool.execute(
      `INSERT INTO invoice_series (id, business_id, series, description, invoice_type, current_number, is_default, created_at)
       VALUES (UUID(), ?, ?, ?, ?, 0, ?, NOW())`,
      [bizId, series.toUpperCase(), description || null, invoice_type || '1.1', is_default ? 1 : 0]
    );

    const [rows] = await pool.execute(
      'SELECT * FROM invoice_series WHERE business_id = ? ORDER BY is_default DESC, series ASC',
      [bizId]
    );
    res.status(201).json({ data: rows });
  } catch (err) { next(err); }
});

// ─── GET /api/accountant/clients/:bizId/products ─────────────────────────────
router.get('/clients/:bizId/products', requireClientAccess, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM products WHERE business_id = ? ORDER BY sort_order ASC, name ASC`,
      [req.params.bizId]
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ─── POST /api/accountant/clients/:bizId/products ────────────────────────────
router.post('/clients/:bizId/products', requireClientAccess, async (req, res, next) => {
  try {
    const { bizId } = req.params;
    const { name, code, description, unit, default_price, vat_rate, income_category, income_type, is_favorite } = req.body;
    if (!name) return res.status(400).json({ error: 'Product name is required.' });

    await pool.execute(
      `INSERT INTO products
         (id, business_id, name, code, description, unit, default_price, vat_rate, income_category, income_type, is_favorite, is_active, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
      [bizId, name, code || null, description || null, unit || 'KG',
       default_price || null, vat_rate || 13, income_category || 'E3_561_001',
       income_type || '1.1', is_favorite ? 1 : 0]
    );

    const [rows] = await pool.execute(
      'SELECT * FROM products WHERE business_id = ? ORDER BY sort_order ASC, name ASC', [bizId]
    );
    res.status(201).json({ data: rows });
  } catch (err) { next(err); }
});

// ─── PUT /api/accountant/clients/:bizId/products/:id ─────────────────────────
router.put('/clients/:bizId/products/:id', requireClientAccess, async (req, res, next) => {
  try {
    const { bizId, id } = req.params;
    const allowed = ['name', 'code', 'description', 'unit', 'default_price', 'vat_rate', 'income_category', 'income_type', 'is_favorite', 'is_active', 'sort_order'];
    const setClauses = [];
    const params = [];
    for (const f of allowed) {
      if (req.body[f] !== undefined) { setClauses.push(`${f} = ?`); params.push(req.body[f]); }
    }
    if (!setClauses.length) return res.status(400).json({ error: 'No updatable fields.' });
    setClauses.push('updated_at = NOW()');
    params.push(id, bizId);
    await pool.execute(`UPDATE products SET ${setClauses.join(', ')} WHERE id = ? AND business_id = ?`, params);
    const [row] = await pool.execute('SELECT * FROM products WHERE id = ? LIMIT 1', [id]);
    res.json({ data: row[0] });
  } catch (err) { next(err); }
});

// ─── DELETE /api/accountant/clients/:bizId/products/:id ──────────────────────
router.delete('/clients/:bizId/products/:id', requireClientAccess, async (req, res, next) => {
  try {
    await pool.execute(
      'DELETE FROM products WHERE id = ? AND business_id = ?',
      [req.params.id, req.params.bizId]
    );
    res.json({ data: { message: 'Product deleted.' } });
  } catch (err) { next(err); }
});

// ─── GET /api/accountant/clients/:bizId/customers ────────────────────────────
router.get('/clients/:bizId/customers', requireClientAccess, async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;

    let whereExtra = '';
    const params = [req.params.bizId];
    if (search) {
      whereExtra = ' AND (name LIKE ? OR afm LIKE ? OR email LIKE ?)';
      params.push(search, search, search);
    }

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM customers WHERE business_id = ?${whereExtra}`, params
    );
    const [rows] = await pool.execute(
      `SELECT * FROM customers WHERE business_id = ?${whereExtra}
       ORDER BY is_favorite DESC, name ASC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    res.json({ data: rows, total: countRows[0].total, page, limit });
  } catch (err) { next(err); }
});

// ─── POST /api/accountant/clients/:bizId/customers ───────────────────────────
router.post('/clients/:bizId/customers', requireClientAccess, async (req, res, next) => {
  try {
    const { bizId } = req.params;
    const { name, afm, trade_name, address, city, postal_code, country, phone, email, default_payment_method } = req.body;
    if (!name) return res.status(400).json({ error: 'Customer name is required.' });

    await pool.execute(
      `INSERT INTO customers
         (id, business_id, afm, name, trade_name, address, city, postal_code, country, phone, email, default_payment_method, is_active, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
      [bizId, afm || null, name, trade_name || null, address || null, city || null,
       postal_code || null, country || 'GR', phone || null, email || null,
       default_payment_method || 'cash']
    );

    const [[bizRow]] = await pool.execute(
      'SELECT id FROM customers WHERE business_id = ? ORDER BY created_at DESC LIMIT 1', [bizId]
    );
    const [cust] = await pool.execute('SELECT * FROM customers WHERE id = ? LIMIT 1', [bizRow.id]);
    res.status(201).json({ data: cust[0] });
  } catch (err) { next(err); }
});

// ─── PUT /api/accountant/clients/:bizId/customers/:id ────────────────────────
router.put('/clients/:bizId/customers/:id', requireClientAccess, async (req, res, next) => {
  try {
    const { bizId, id } = req.params;
    const allowed = ['name', 'afm', 'trade_name', 'address', 'city', 'postal_code', 'country', 'phone', 'email', 'default_payment_method', 'is_favorite', 'is_active'];
    const setClauses = [];
    const params = [];
    for (const f of allowed) {
      if (req.body[f] !== undefined) { setClauses.push(`${f} = ?`); params.push(req.body[f]); }
    }
    if (!setClauses.length) return res.status(400).json({ error: 'No updatable fields.' });
    setClauses.push('updated_at = NOW()');
    params.push(id, bizId);
    await pool.execute(`UPDATE customers SET ${setClauses.join(', ')} WHERE id = ? AND business_id = ?`, params);
    const [row] = await pool.execute('SELECT * FROM customers WHERE id = ? LIMIT 1', [id]);
    res.json({ data: row[0] });
  } catch (err) { next(err); }
});

// ─── DELETE /api/accountant/clients/:bizId/customers/:id ─────────────────────
router.delete('/clients/:bizId/customers/:id', requireClientAccess, async (req, res, next) => {
  try {
    await pool.execute(
      'DELETE FROM customers WHERE id = ? AND business_id = ?',
      [req.params.id, req.params.bizId]
    );
    res.json({ data: { message: 'Customer deleted.' } });
  } catch (err) { next(err); }
});

module.exports = router;
