/**
 * Business Credentials Vault — /api/credentials
 * Super-admin only. Stores sensitive credentials per business.
 * GSIS/taxisnet + myDATA are stored directly in the businesses table;
 * OSPA, TIMOLOGIO, Epsilon Smart, and notes go in business_credentials.
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../config/database');
const { authenticate }        = require('../middleware/auth');
const { sendAdminActionEmail } = require('../services/email.service');

router.use(authenticate);
router.use((req, res, next) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Δεν επιτρέπεται.' });
  next();
});

// ── Self-migration ────────────────────────────────────────────────────────────
(async () => {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS business_credentials (
        business_id           CHAR(36)     NOT NULL,
        ospa_username         VARCHAR(255) NULL DEFAULT NULL,
        ospa_password         VARCHAR(500) NULL DEFAULT NULL,
        timologio_username    VARCHAR(255) NULL DEFAULT NULL,
        timologio_password    VARCHAR(500) NULL DEFAULT NULL,
        timologio_afm         VARCHAR(15)  NULL DEFAULT NULL,
        epsilon_username      VARCHAR(255) NULL DEFAULT NULL,
        epsilon_password      VARCHAR(500) NULL DEFAULT NULL,
        extra_notes           TEXT         NULL DEFAULT NULL,
        updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                           ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (business_id),
        CONSTRAINT fk_biz_creds FOREIGN KEY (business_id)
          REFERENCES businesses (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    // Add timologio_afm column to existing tables that predate this migration
    await pool.execute(
      `ALTER TABLE business_credentials ADD COLUMN IF NOT EXISTS timologio_afm VARCHAR(15) NULL DEFAULT NULL`
    ).catch(() => {});
    console.log('[credentials] table ready');
  } catch (e) {
    console.error('[credentials] migration error:', e.message);
  }
})();

// ── GET /api/credentials ──────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        b.id, b.name, b.afm, b.email, b.city, b.phone,
        COALESCE(b.gsis_username, '')            AS gsis_username,
        COALESCE(b.gsis_password, '')            AS gsis_password,
        COALESCE(b.mydata_user_id, '')           AS mydata_user_id,
        COALESCE(b.mydata_subscription_key, '')  AS mydata_subscription_key,
        COALESCE(c.ospa_username, '')            AS ospa_username,
        COALESCE(c.ospa_password, '')            AS ospa_password,
        COALESCE(c.timologio_username, '')       AS timologio_username,
        COALESCE(c.timologio_password, '')       AS timologio_password,
        COALESCE(c.timologio_afm, '')            AS timologio_afm,
        COALESCE(c.epsilon_username, '')         AS epsilon_username,
        COALESCE(c.epsilon_password, '')         AS epsilon_password,
        COALESCE(c.extra_notes, '')              AS extra_notes,
        c.updated_at                             AS creds_updated_at
      FROM businesses b
      LEFT JOIN business_credentials c ON c.business_id = b.id
      ORDER BY b.name ASC
    `);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ── POST /api/credentials/notify-access ───────────────────────────────────────
router.post('/notify-access', async (req, res, next) => {
  try {
    const [[cfg]] = await pool.execute(
      "SELECT setting_value FROM platform_settings WHERE setting_key = 'admin_notification_email' LIMIT 1"
    ).catch(() => [[null]]);
    const to = (cfg?.setting_value) || process.env.ADMIN_EMAIL || 'admin@fishbill.gr';
    const now = new Date().toLocaleString('el-GR', { timeZone: 'Europe/Athens' });
    const ip  = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '—';

    await sendAdminActionEmail({
      adminEmail: to,
      subject:    `🔐 Πρόσβαση Θησαυροφυλακίου — ${now}`,
      bodyHtml: `
        <h2 style="color:#0A5568;margin:0 0 16px">🔐 Άνοιγμα Θησαυροφυλακίου</h2>
        <p style="color:#333;font-size:14px;">Ανοίχτηκε η σελίδα <strong>Διαπιστευτηρίων Επιχειρήσεων</strong> στο Admin Panel.</p>
        <table style="border-collapse:collapse;width:100%;margin-top:12px;font-size:13px;">
          <tr style="background:#f5fbfc;">
            <td style="padding:8px 14px;color:#666;font-weight:600;border:1px solid #d5edf2;width:130px;">Ώρα</td>
            <td style="padding:8px 14px;border:1px solid #d5edf2;font-weight:700;">${now}</td>
          </tr>
          <tr>
            <td style="padding:8px 14px;color:#666;font-weight:600;border:1px solid #d5edf2;">IP</td>
            <td style="padding:8px 14px;border:1px solid #d5edf2;">${ip}</td>
          </tr>
        </table>
        <p style="color:#999;font-size:12px;margin-top:16px;">Αν δεν ήσουν εσύ, άλλαξε αμέσως τον κωδικό admin.</p>
      `,
    });
    res.json({ data: { sent: true } });
  } catch (err) {
    res.json({ data: { sent: false } }); // non-fatal
  }
});

// ── PUT /api/credentials/:business_id ────────────────────────────────────────
router.put('/:business_id', async (req, res, next) => {
  try {
    const { business_id } = req.params;
    const {
      gsis_username, gsis_password,
      mydata_user_id, mydata_subscription_key,
      ospa_username, ospa_password,
      timologio_username, timologio_password, timologio_afm,
      epsilon_username, epsilon_password,
      extra_notes,
    } = req.body;

    // Update businesses table (gsis + mydata already live there)
    await pool.execute(
      `UPDATE businesses SET
         gsis_username = ?, gsis_password = ?,
         mydata_user_id = ?, mydata_subscription_key = ?,
         updated_at = NOW()
       WHERE id = ?`,
      [
        gsis_username || null, gsis_password || null,
        mydata_user_id || null, mydata_subscription_key || null,
        business_id,
      ]
    );

    // Upsert business_credentials for the rest
    await pool.execute(
      `INSERT INTO business_credentials
         (business_id, ospa_username, ospa_password,
          timologio_username, timologio_password, timologio_afm,
          epsilon_username, epsilon_password, extra_notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         ospa_username      = VALUES(ospa_username),
         ospa_password      = VALUES(ospa_password),
         timologio_username = VALUES(timologio_username),
         timologio_password = VALUES(timologio_password),
         timologio_afm      = VALUES(timologio_afm),
         epsilon_username   = VALUES(epsilon_username),
         epsilon_password   = VALUES(epsilon_password),
         extra_notes        = VALUES(extra_notes),
         updated_at         = NOW()`,
      [
        business_id,
        ospa_username || null, ospa_password || null,
        timologio_username || null, timologio_password || null, timologio_afm || null,
        epsilon_username || null, epsilon_password || null,
        extra_notes || null,
      ]
    );

    res.json({ data: { message: 'Αποθηκεύτηκε επιτυχώς.' } });
  } catch (err) { next(err); }
});

module.exports = router;
