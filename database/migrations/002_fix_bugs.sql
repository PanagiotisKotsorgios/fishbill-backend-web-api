-- FishBill Migration 002 — Fix column mismatches between schema and routes
-- Run against fishbill_db ONCE after migration 001
-- Note: MySQL does not support ADD COLUMN IF NOT EXISTS — run only if not already applied.

USE fishbill_db;

-- ── backup_logs: add missing columns used by backups.routes.js ─────────────
ALTER TABLE backup_logs
  MODIFY COLUMN filename VARCHAR(255) NULL,
  ADD COLUMN initiated_by  CHAR(36)     NULL AFTER id,
  ADD COLUMN file_path     VARCHAR(500) NULL,
  ADD COLUMN file_size     BIGINT       NULL,
  ADD COLUMN error_message TEXT         NULL,
  ADD COLUMN completed_at  DATETIME     NULL,
  ADD COLUMN updated_at    DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE backup_logs
  ADD FOREIGN KEY (initiated_by) REFERENCES users(id) ON DELETE SET NULL;

-- ── invoices: add notes column used in route INSERT ────────────────────────
ALTER TABLE invoices
  ADD COLUMN notes TEXT NULL AFTER last_error;

-- ── Fix super admin password hash (old hash in schema was wrong) ───────────
UPDATE users
SET password_hash = '$2b$12$Gil9s7yeIoHwmYnTGBbdzuzNzIgq/8eRRVJoe7iuv7PLL4/YBpWKm'
WHERE email = 'admin@fishbill.gr'
  AND role  = 'super_admin';

SELECT 'Migration 002 applied successfully.' AS result;
