-- Migration 020: Add transmitted_at column to delivery_notes and invoices
-- Uses INFORMATION_SCHEMA check since MySQL on XAMPP doesn't support IF NOT EXISTS for ADD COLUMN

SET @dbname = DATABASE();

-- delivery_notes.transmitted_at
SET @col1 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'delivery_notes' AND COLUMN_NAME = 'transmitted_at');
SET @sql1 = IF(@col1 = 0,
  'ALTER TABLE delivery_notes ADD COLUMN transmitted_at DATETIME DEFAULT NULL AFTER mydata_response',
  'SELECT 1');
PREPARE stmt FROM @sql1; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- invoices.transmitted_at
SET @col2 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'transmitted_at');
SET @sql2 = IF(@col2 = 0,
  'ALTER TABLE invoices ADD COLUMN transmitted_at DATETIME DEFAULT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql2; EXECUTE stmt; DEALLOCATE PREPARE stmt;
