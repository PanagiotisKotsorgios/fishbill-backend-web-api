/**
 * Employee Privilege Management Routes
 * Super Admin grants/revokes specific privileges to system employees.
 * All destructive actions require email OTP verification.
 */
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/role');
const crypto = require('crypto');
const emailSvc = require('../services/email.service');

router.use(authenticate);

// ── Valid privilege keys ──────────────────────────────────────────────────────
const VALID_PRIVILEGES = [
  'view_dashboard', 'view_invoices', 'edit_invoices', 'delete_invoices',
  'view_customers', 'edit_customers', 'delete_customers',
  'view_products', 'edit_products',
  'view_users', 'edit_users',
  'view_logs', 'view_reports',
  'view_businesses', 'edit_businesses',
  'view_backups', 'create_backups',
  'view_exports', 'create_exports',
  'manage_settings',
  // Maintainer privileges
  'verify_users',            // verify/unverify user accounts in assigned businesses
  'monitor_ospa',            // view OSPA submissions for assigned businesses
  'monitor_weighing_slips',  // view weighing slips for assigned businesses
  'view_subscriptions',      // view subscription & payment info for assigned businesses
  'manage_reminders',        // log SMS reminders for assigned businesses
  // Admin module access (employee working autonomously in admin panel)
  'admin_credentials',       // Θησαυροφυλάκιο — credentials vault (scoped to assigned businesses)
  'admin_mydata_inbox',      // Εισερχόμενα myDATA
  'admin_delivery_notes',    // Δελτία Αποστολής inbox — transmit, mark, upload PDF
  'admin_charges',           // Χρεώσεις
  'admin_sms',               // Υπενθυμίσεις SMS
  'admin_platform',          // Πλατφόρμα
  'admin_campaigns',         // Email & Campaigns
];

// ── Send OTP email helper ─────────────────────────────────────────────────────
async function sendOtp(toEmail, otp, action) {
  const html = `<!DOCTYPE html>
<html lang="el"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f0f7f9;font-family:Inter,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7f9;padding:32px 16px">
  <tr><td align="center">
    <table width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(11,114,133,.12)">
      <tr><td style="background:linear-gradient(135deg,#0A5568,#0B7285);padding:24px 32px;text-align:center">
        <div style="font-size:24px;font-weight:900;color:#fff;letter-spacing:1.5px">🐟 FishBill</div>
        <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:2px">Ασφάλεια Λογαριασμού</div>
      </td></tr>
      <tr><td style="padding:32px">
        <h2 style="color:#0A5568;margin:0 0 12px;font-size:20px">Επιβεβαίωση Ενέργειας</h2>
        <p style="color:#374151;font-size:14px;margin:0 0 8px">Ενέργεια: <strong>${action}</strong></p>
        <p style="color:#374151;font-size:14px;margin:0 0 16px">Ο κωδικός επιβεβαίωσής σας:</p>
        <div style="font-size:40px;font-weight:900;letter-spacing:10px;color:#0B7285;background:#f0f7f9;border:2px solid #ceeaee;padding:24px;border-radius:12px;text-align:center;margin:0 0 20px">${otp}</div>
        <p style="color:#6B7280;font-size:13px;margin:0 0 8px">Ισχύει για <strong>10 λεπτά</strong>. Μην τον μοιραστείτε με κανέναν.</p>
        <p style="color:#9CA3AF;font-size:12px;margin:0">Αν δεν ζητήσατε αυτή την ενέργεια, αγνοήστε αυτό το email.</p>
      </td></tr>
      <tr><td style="background:#f5fbfc;padding:16px 32px;text-align:center;border-top:1px solid #d5edf2">
        <p style="margin:0;font-size:12px;color:#8aacb4">&copy; 2026 FishBill · Ηλεκτρονική Τιμολόγηση myDATA για Αλιείς</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  await emailSvc.sendEmail({
    to: toEmail,
    subject: `[FishBill] Κωδικός Επιβεβαίωσης — ${action}`,
    html,
  });
}

// ── GET /api/employees — list all employees with privileges + biz count ────────
router.get('/', requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.full_name AS name, u.email, u.is_active, u.created_at,
              ep.privileges, ep.granted_by, ep.granted_at,
              (SELECT COUNT(*) FROM employee_businesses eb WHERE eb.employee_id = u.id) AS biz_count
       FROM users u
       LEFT JOIN employee_privileges ep ON ep.user_id = u.id
       WHERE u.role = 'employee'
       ORDER BY u.created_at DESC`
    );
    res.json({ employees: rows.map(r => ({
      ...r,
      privileges: r.privileges ? JSON.parse(r.privileges) : [],
      biz_count: parseInt(r.biz_count) || 0,
    })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/employees/:id/businesses — list assigned businesses ───────────────
router.get('/:id/businesses', requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT b.id, b.name, b.afm, b.plan, b.subscription_active, eb.assigned_at
       FROM employee_businesses eb
       JOIN businesses b ON b.id = eb.business_id
       WHERE eb.employee_id = ?
       ORDER BY b.name ASC`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/employees/:id/businesses — replace assigned businesses ────────────
router.put('/:id/businesses', requireSuperAdmin, async (req, res) => {
  const { business_ids } = req.body;
  if (!Array.isArray(business_ids)) return res.status(400).json({ error: 'business_ids must be an array.' });

  const [[emp]] = await db.query("SELECT id FROM users WHERE id = ? AND role='employee' LIMIT 1", [req.params.id]);
  if (!emp) return res.status(404).json({ error: 'Employee not found.' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM employee_businesses WHERE employee_id = ?', [req.params.id]);
    if (business_ids.length) {
      const vals = business_ids.map(bid => [require('crypto').randomUUID(), req.params.id, bid, req.user.id]);
      await conn.query(
        'INSERT IGNORE INTO employee_businesses (id, employee_id, business_id, assigned_by) VALUES ?',
        [vals]
      );
    }
    await conn.commit();
    res.json({ data: { assigned: business_ids.length } });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

// ── GET /api/employees/:id/privileges ─────────────────────────────────────────
router.get('/:id/privileges', requireSuperAdmin, async (req, res) => {
  try {
    const [[row]] = await db.query(
      'SELECT privileges FROM employee_privileges WHERE user_id = ?',
      [req.params.id]
    );
    res.json({ privileges: row ? JSON.parse(row.privileges || '[]') : [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/employees/request-otp — send OTP to super_admin email ───────────
router.post('/request-otp', requireSuperAdmin, async (req, res) => {
  const { action } = req.body;
  if (!action) return res.status(400).json({ error: 'action required' });

  try {
    const otp = crypto.randomInt(100000, 999999).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    // Store OTP in platform_settings
    const key = `emp_otp_${req.user.id}`;
    const val = JSON.stringify({ otp, action, expires: expires.toISOString() });
    await db.query(
      `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = ?`,
      [key, val, val]
    );

    await sendOtp(req.user.email, otp, action);
    res.json({ message: `OTP sent to ${req.user.email}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/employees/:id/privileges — set privileges (requires OTP) ────────
router.post('/:id/privileges', requireSuperAdmin, async (req, res) => {
  const { privileges, otp } = req.body;
  const employeeId = req.params.id;

  if (!Array.isArray(privileges))
    return res.status(400).json({ error: 'privileges must be an array' });

  // Validate privilege keys
  const invalid = privileges.filter(p => !VALID_PRIVILEGES.includes(p));
  if (invalid.length)
    return res.status(400).json({ error: `Invalid privileges: ${invalid.join(', ')}` });

  // Verify OTP
  const key = `emp_otp_${req.user.id}`;
  try {
    const [[row]] = await db.query(
      'SELECT setting_value FROM platform_settings WHERE setting_key = ?', [key]
    );
    if (!row) return res.status(400).json({ error: 'OTP not found. Request a new one.' });

    const stored = JSON.parse(row.setting_value);
    if (new Date() > new Date(stored.expires))
      return res.status(400).json({ error: 'OTP expired. Request a new one.' });
    if (stored.otp !== String(otp))
      return res.status(400).json({ error: 'Λανθασμένος κωδικός OTP.' });

    // Check target is actually an employee
    const [[emp]] = await db.query(
      "SELECT id, full_name, role FROM users WHERE id = ? AND role = 'employee'",
      [employeeId]
    );
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });

    // Upsert privileges
    const privJson = JSON.stringify(privileges);
    await db.query(
      `INSERT INTO employee_privileges (user_id, privileges, granted_by, granted_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE privileges = ?, granted_by = ?, granted_at = NOW()`,
      [employeeId, privJson, req.user.id, privJson, req.user.id]
    );

    // Clean up OTP
    await db.query("DELETE FROM platform_settings WHERE setting_key = ?", [key]);

    res.json({ message: `Privileges updated for ${emp.full_name}`, privileges });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/employees/my-privileges — employee gets their own privileges ─────
router.get('/my-privileges', async (req, res) => {
  if (req.user.role !== 'employee')
    return res.status(403).json({ error: 'Only for employees.' });
  try {
    const [[row]] = await db.query(
      'SELECT privileges FROM employee_privileges WHERE user_id = ?',
      [req.user.id]
    );
    res.json({ privileges: row ? JSON.parse(row.privileges || '[]') : [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Valid privilege definitions (for UI) ──────────────────────────────────────
router.get('/privilege-definitions', requireSuperAdmin, (req, res) => {
  res.json({ privileges: VALID_PRIVILEGES });
});

// ── GET /api/employees/associations — list associations for the UI ─────────────
router.get('/associations', requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT a.id, a.name, a.region,
             COUNT(b.id) AS business_count
      FROM business_associations a
      LEFT JOIN businesses b ON b.association_id = a.id
      GROUP BY a.id, a.name, a.region
      ORDER BY a.name ASC
    `);
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/employees/:id/assign-association/:assocId — bulk assign ──────────
router.post('/:id/assign-association/:assocId', requireSuperAdmin, async (req, res) => {
  const { id: empId, assocId } = req.params;
  try {
    const [[emp]] = await db.query("SELECT id FROM users WHERE id=? AND role='employee' LIMIT 1", [empId]);
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });

    const [bizRows] = await db.query('SELECT id FROM businesses WHERE association_id = ?', [assocId]);
    if (bizRows.length) {
      const vals = bizRows.map(b => [crypto.randomUUID(), empId, b.id, req.user.id]);
      await db.query('INSERT IGNORE INTO employee_businesses (id, employee_id, business_id, assigned_by) VALUES ?', [vals]);
    }

    const [assigned] = await db.query('SELECT business_id FROM employee_businesses WHERE employee_id = ?', [empId]);
    res.json({ data: { added: bizRows.length, business_ids: assigned.map(r => r.business_id) } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/employees/:id/assign-association/:assocId — bulk remove ────────
router.delete('/:id/assign-association/:assocId', requireSuperAdmin, async (req, res) => {
  const { id: empId, assocId } = req.params;
  try {
    const [bizRows] = await db.query('SELECT id FROM businesses WHERE association_id = ?', [assocId]);
    if (bizRows.length) {
      const bizIds = bizRows.map(b => b.id);
      await db.query(
        `DELETE FROM employee_businesses WHERE employee_id = ? AND business_id IN (${bizIds.map(() => '?').join(',')})`,
        [empId, ...bizIds]
      );
    }

    const [assigned] = await db.query('SELECT business_id FROM employee_businesses WHERE employee_id = ?', [empId]);
    res.json({ data: { removed: bizRows.length, business_ids: assigned.map(r => r.business_id) } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/employees — create a new system employee ───────────────────────
router.post('/', requireSuperAdmin, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Ονοματεπώνυμο, email και κωδικός απαιτούνται.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.' });
  }
  try {
    const bcrypt = require('bcrypt');
    const [existing] = await db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing.length) {
      return res.status(409).json({ error: 'Χρήστης με αυτό το email υπάρχει ήδη.' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await db.query(
      `INSERT INTO users (id, business_id, full_name, email, password_hash, role, is_active, created_at, updated_at)
       VALUES (UUID(), NULL, ?, ?, ?, 'employee', 1, NOW(), NOW())`,
      [name, email, passwordHash]
    );
    res.status(201).json({ data: { message: 'Εργαζόμενος δημιουργήθηκε επιτυχώς.' } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
