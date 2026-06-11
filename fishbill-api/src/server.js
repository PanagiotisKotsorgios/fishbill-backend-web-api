require('dotenv').config();

// ── Step 1: Validate secrets before anything else ─────────────────────────────
const { validateEnv } = require('./utils/validateEnv');
validateEnv();

// ── Step 2: Boot the app ──────────────────────────────────────────────────────
const app    = require('./app');
const pool   = require('./config/database');
const logger = require('./utils/logger');
const { startEmailCampaigns } = require('./jobs/emailCampaigns');
const { startAutoTransmit }  = require('./jobs/autoTransmit');

const PORT = process.env.PORT || 4000;

// ── Startup migrations (additive only — safe to run on every boot) ────────────
async function addColumnIfMissing(table, column, definition) {
  try {
    const [cols] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    if (!cols.length) {
      await pool.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
      logger.info(`Migration: added ${table}.${column}`);
    }
  } catch (e) {
    logger.warn(`Migration failed for ${table}.${column}: ${e.message}`);
  }
}

async function runMigrations() {
  await addColumnIfMissing('users', 'email_verify_token',   'VARCHAR(255) NULL');
  await addColumnIfMissing('users', 'email_verify_expires', 'DATETIME NULL');
  await addColumnIfMissing('users', 'last_login_at',        'DATETIME NULL');
  await addColumnIfMissing('users', 'last_login_ip',        'VARCHAR(45) NULL');
  await addColumnIfMissing('users', 'last_seen_at',         'DATETIME NULL');
  await addColumnIfMissing('businesses', 'billing_cycle',              "VARCHAR(20) NULL DEFAULT 'monthly'");
  await addColumnIfMissing('businesses', 'is_first_subscription',      'TINYINT(1) NOT NULL DEFAULT 1');
  await addColumnIfMissing('businesses', 'fishing_license',            'VARCHAR(60) NULL');
  await addColumnIfMissing('businesses', 'mydata_user_id',             'VARCHAR(100) NULL DEFAULT NULL');
  await addColumnIfMissing('businesses', 'mydata_subscription_key',    'VARCHAR(200) NULL DEFAULT NULL');
  await addColumnIfMissing('delivery_notes', 'dispatch_time',          "TIME NULL DEFAULT NULL");
  await addColumnIfMissing('delivery_notes', 'mydata_mark',            'VARCHAR(50) NULL DEFAULT NULL');
  await addColumnIfMissing('delivery_notes', 'mydata_uid',             'VARCHAR(100) NULL DEFAULT NULL');
  await addColumnIfMissing('delivery_notes', 'mydata_response',        'TEXT NULL DEFAULT NULL');
  await addColumnIfMissing('delivery_notes', 'transmitted_at',         'DATETIME NULL DEFAULT NULL');
  await addColumnIfMissing('delivery_notes', 'pdf_path',               'VARCHAR(500) NULL DEFAULT NULL');
  await addColumnIfMissing('delivery_notes', 'wrapp_invoice_id',       'VARCHAR(100) NULL DEFAULT NULL');
  await addColumnIfMissing('delivery_notes', 'wrapp_mark',             'VARCHAR(50) NULL DEFAULT NULL');
  await addColumnIfMissing('delivery_notes', 'wrapp_qr_url',           'VARCHAR(500) NULL DEFAULT NULL');
  await addColumnIfMissing('business_settings', 'default_vat_rate',    'TINYINT NOT NULL DEFAULT 13');
  await addColumnIfMissing('businesses', 'billing_cycle_started_at',   'DATE NULL DEFAULT NULL');
  await addColumnIfMissing('businesses', 'wrapp_partner_user_id',      'VARCHAR(255) NULL DEFAULT NULL');
  await addColumnIfMissing('businesses', 'wrapp_billing_book_inv_id',  'VARCHAR(100) NULL DEFAULT NULL');
  await addColumnIfMissing('businesses', 'wrapp_billing_book_dn_id',   'VARCHAR(100) NULL DEFAULT NULL');
  await addColumnIfMissing('invoices',   'wrapp_invoice_id',           'VARCHAR(100) NULL DEFAULT NULL');
  await addColumnIfMissing('invoices',   'wrapp_qr_url',               'VARCHAR(500) NULL DEFAULT NULL');
  await addColumnIfMissing('invoices',   'pdf_path',                   'VARCHAR(500) NULL DEFAULT NULL');
  await addColumnIfMissing('invoices',   'wrapp_pdf_url',              'VARCHAR(1000) NULL DEFAULT NULL');
  await addColumnIfMissing('delivery_notes', 'wrapp_pdf_url',          'VARCHAR(1000) NULL DEFAULT NULL');
  await addColumnIfMissing('delivery_notes', 'cancellation_mark',      'VARCHAR(50) NULL DEFAULT NULL');
  await addColumnIfMissing('delivery_notes', 'cancellation_pending',   'TINYINT(1) NOT NULL DEFAULT 0');
  // Price correction: ensure price_pro is 12 (was 15)
  try {
    await pool.execute(
      "UPDATE platform_settings SET setting_value = '12' WHERE setting_key = 'price_pro' AND setting_value = '15'"
    );
  } catch (_) {}

  // myDATA-code correction: 1.3 (Τιμολόγιο πώλησης τρίτων χωρών) was being used
  // incorrectly for partial credit invoices. Migrate any pending/failed 1.3 rows
  // to the correct 1.5 code so the auto-transmit cron picks them up cleanly.
  try {
    const [result] = await pool.execute(
      "UPDATE invoices SET invoice_type = '1.5', updated_at = NOW() WHERE invoice_type = '1.3' AND status IN ('draft','failed','issued')"
    );
    if (result?.affectedRows) {
      logger.info(`Migration: corrected ${result.affectedRows} pending/failed invoices from type 1.3 → 1.5`);
    }
  } catch (e) {
    logger.warn(`Migration 1.3→1.5 skipped: ${e.message}`);
  }
  logger.info('DB migrations complete.');
}

const server = app.listen(PORT, '0.0.0.0', async () => {
  await runMigrations();
  logger.info(`FishBill API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  startEmailCampaigns(pool);
  startAutoTransmit();
});

// ── Unhandled rejections ──────────────────────────────────────────────────────
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection', { error: err.message, stack: err.stack });
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(1);
  });
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(async () => {
    try {
      await pool.end();
      logger.info('Database pool drained. Process terminated.');
    } catch (err) {
      logger.error('Error draining pool', { error: err.message });
    }
    process.exit(0);
  });

  // Force-kill after 10 s if connections don't close cleanly
  setTimeout(() => {
    logger.error('Forced exit after 10 s shutdown timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
