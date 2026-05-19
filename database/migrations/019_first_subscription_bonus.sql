-- Migration 019: Add is_first_subscription flag to businesses
-- When a business first pays, they get +1 month free. This flag tracks whether
-- the bonus month has been applied yet. Set to 0 after first activation.

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'businesses'
    AND COLUMN_NAME  = 'is_first_subscription'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE businesses ADD COLUMN is_first_subscription TINYINT(1) NOT NULL DEFAULT 1 AFTER subscription_active',
  'SELECT "is_first_subscription column already exists" AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
