-- Migration 021: Add etimologiera_api_key to businesses table
-- Companion to add_etimologiera_username.sql (which added etimologiera_username).
-- Uses INFORMATION_SCHEMA guard so it is safe to run multiple times.

SET @dbname = DATABASE();

SET @col1 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'businesses' AND COLUMN_NAME = 'etimologiera_api_key');
SET @sql1 = IF(@col1 = 0,
  "ALTER TABLE businesses ADD COLUMN etimologiera_api_key VARCHAR(512) NULL COMMENT 'e-timologiera API key (password) — per business' AFTER etimologiera_username",
  'SELECT 1');
PREPARE stmt FROM @sql1; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 021 OK — etimologiera_api_key added to businesses' AS status;
