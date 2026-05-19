-- ============================================================
-- Migration: e-timologiera Integration Fields
-- Run in phpMyAdmin or MySQL CLI after selecting fishbill_db
-- ============================================================
USE fishbill_db;

-- Add etimologiera-specific columns to invoices table (MySQL 8 compatible guards)
SET @col_qr = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'fishbill_db' AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'mydata_qr');
SET @sql_qr = IF(@col_qr = 0,
  "ALTER TABLE invoices ADD COLUMN mydata_qr TEXT NULL COMMENT 'QR code URL returned by e-timologiera / AADE'",
  'SELECT 1');
PREPARE stmt FROM @sql_qr; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_uid = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'fishbill_db' AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'etimologiera_uid');
SET @sql_uid = IF(@col_uid = 0,
  "ALTER TABLE invoices ADD COLUMN etimologiera_uid VARCHAR(128) NULL COMMENT 'Unique invoice ID assigned by e-timologiera'",
  'SELECT 1');
PREPARE stmt FROM @sql_uid; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index for etimologiera UID lookups (MySQL 8 compatible guard)
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = 'fishbill_db' AND TABLE_NAME = 'invoices' AND INDEX_NAME = 'idx_invoices_etim_uid');
SET @sql_idx = IF(@idx = 0,
  'CREATE INDEX idx_invoices_etim_uid ON invoices (etimologiera_uid)',
  'SELECT 1');
PREPARE stmt FROM @sql_idx; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Verify
SELECT 'etimologiera migration OK' AS status;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'fishbill_db'
  AND TABLE_NAME   = 'invoices'
  AND COLUMN_NAME IN ('mydata_mark','mydata_qr','etimologiera_uid');
