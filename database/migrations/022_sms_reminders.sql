-- Migration 022: Create sms_reminders table for manual SMS logging by admin
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS sms_reminders (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  business_id  CHAR(36)     NOT NULL,
  phone_number VARCHAR(30)  NOT NULL,
  sent_by      CHAR(36)     NULL,
  sent_by_name VARCHAR(100) NULL,
  sent_at      DATETIME     NOT NULL,
  reason       ENUM('trial_expiring','subscription_expiring','payment_reminder','other') NOT NULL DEFAULT 'trial_expiring',
  notes        TEXT         NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sms_rem_biz FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 022 OK — sms_reminders table created' AS status;
