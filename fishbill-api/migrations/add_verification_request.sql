-- ============================================================
-- Migration: Accountant Verification Request Tracking
-- Run in phpMyAdmin after selecting fishbill_db
-- ============================================================
USE fishbill_db;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verification_requested_at DATETIME NULL
    COMMENT 'When accountant submitted verification request'
  AFTER is_verified,

  ADD COLUMN IF NOT EXISTS verification_data JSON NULL
    COMMENT 'JSON with submitted form data (name, AFM, license number, etc.)'
  AFTER verification_requested_at;

-- Add platform-level admin email setting (used for verification notification emails)
INSERT IGNORE INTO platform_settings (setting_key, setting_value)
VALUES ('admin_notification_email', 'admin@fishbill.gr');

SELECT 'verification_request migration OK' AS status;
