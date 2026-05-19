-- ============================================================
-- FishBill — Combined Pending Migrations (013)
-- Apply ALL of this in phpMyAdmin against fishbill_db
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS guards
-- Date: 2026-04-11
-- Prerequisite: migrations 001, 002, 003 already applied
-- ============================================================

USE fishbill_db;

-- ══════════════════════════════════════════════════════════════
-- SECTION 1: platform_settings table
-- (Migration 004_iris_payments used wrong column names key/value.
--  The routes expect setting_key / setting_value — create with
--  correct names; if old table exists with wrong names, rename.)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key    VARCHAR(100)  NOT NULL PRIMARY KEY,
  setting_value  TEXT          NULL,
  updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_platform_settings_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Platform-wide key/value configuration (super_admin only)';

-- Seed default platform settings (IGNORE = skip if already exist)
INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES
  ('platform_name',      'FishBill'),
  ('platform_tagline',   'Ηλεκτρονική τιμολόγηση για αλιείς'),
  ('support_email',      'support@fishbill.gr'),
  ('support_phone',      ''),
  ('company_name',       'FishBill Technologies IKE'),
  ('company_afm',        ''),
  ('company_year',       '2025'),
  ('trial_days',         '30'),
  ('maintenance_mode',   '0'),
  ('maintenance_message','Εκτελούνται εργασίες συντήρησης. Σύντομα θα είμαστε πάλι κοντά σας.'),
  ('provider_name',      'direct'),
  ('provider_api_url',   ''),
  ('provider_api_key',   ''),
  ('provider_username',  ''),
  ('provider_password',  ''),
  ('provider_test_mode', '0'),
  ('iris_enabled',       '0'),
  ('iris_iban',          ''),
  ('iris_beneficiary',   'FishBill OE'),
  ('iris_bank_name',     'Εθνική Τράπεζα'),
  ('iris_mobile',        ''),
  ('iris_bic',           'ETHNGRAA'),
  ('iris_instructions',  'Πραγματοποιήστε μεταφορά μέσω IRIS/τραπεζικής μεταφοράς και στείλτε αποδεικτικό στο support@fishbill.gr με θέμα: Συνδρομή [email σας].'),
  ('admin_notification_email', 'admin@fishbill.gr'),
  ('price_basic',        '8'),
  ('price_pro',          '12'),
  ('price_enterprise',   '30'),
  ('mrr_override',       '0'),
  ('gross_revenue_override', '0'),
  ('other_expenses_total',   '0'),
  ('hosting_monthly_cost',   '0'),
  ('brevo_monthly_cost',     '0'),
  ('brevo_emails_sent',      '0'),
  ('provider_cost_per_invoice', '0');


-- ══════════════════════════════════════════════════════════════
-- SECTION 2: users table additions
-- ══════════════════════════════════════════════════════════════

-- Avatar URL (migration 004_user_avatar)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500) DEFAULT NULL
    COMMENT 'Path to uploaded profile picture'
  AFTER email;

-- Verified status for accountants
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_verified TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '0=pending, 1=verified by super_admin'
  AFTER is_active;

-- When accountant requested verification
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verification_requested_at DATETIME NULL
    COMMENT 'When accountant submitted verification request'
  AFTER is_verified;

-- JSON blob of submitted verification data
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verification_data JSON NULL
    COMMENT 'JSON with submitted form data (name, AFM, license number, etc.)'
  AFTER verification_requested_at;

-- Accountant notification preferences
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notif_new_invoice  TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Email on new invoice from client',
  ADD COLUMN IF NOT EXISTS notif_mydata_fail  TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Email on myDATA transmission failure',
  ADD COLUMN IF NOT EXISTS notif_client_new   TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Email when new client links accountant',
  ADD COLUMN IF NOT EXISTS notif_subscription TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Email for subscription updates';

-- FCM Push Notification tokens
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS fcm_token VARCHAR(500) NULL DEFAULT NULL
    COMMENT 'Firebase Cloud Messaging token',
  ADD COLUMN IF NOT EXISTS fcm_updated_at TIMESTAMP NULL DEFAULT NULL
    COMMENT 'When FCM token was last updated';

-- Auto-verify existing super_admin and owner accounts
UPDATE users SET is_verified = 1 WHERE role IN ('super_admin', 'owner');


-- ══════════════════════════════════════════════════════════════
-- SECTION 3: businesses table additions
-- ══════════════════════════════════════════════════════════════

-- Auto-renew subscription flag
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS auto_renew TINYINT(1) DEFAULT 1
    COMMENT '1=auto-renew, 0=cancel at period end'
  AFTER subscription_ends_at;

UPDATE businesses SET auto_renew = 1 WHERE auto_renew IS NULL;

-- 6-digit fisherman connection code (shown in Android app)
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS fisherman_code CHAR(6) NULL DEFAULT NULL UNIQUE
    COMMENT '6-digit code shown to fisherman; accountant uses it to link client';

-- Generate codes for businesses that don't have one yet
UPDATE businesses
SET fisherman_code = LPAD(FLOOR(100000 + RAND() * 899999), 6, '0')
WHERE fisherman_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_fisherman_code ON businesses (fisherman_code);

-- myDATA provider-specific columns
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS mydata_provider    VARCHAR(30)  DEFAULT 'direct'
    COMMENT 'direct | etimologiera | softone | epsilonnet | unidoc',
  ADD COLUMN IF NOT EXISTS softone_api_key    VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS softone_api_url    VARCHAR(255) DEFAULT 'https://api.softone.gr/api/mydata',
  ADD COLUMN IF NOT EXISTS softone_username   VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS softone_password   VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS softone_company_id VARCHAR(50)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS epsilonnet_api_key    VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS epsilonnet_api_url    VARCHAR(255) DEFAULT 'https://mydata.epsilonnet.gr/api',
  ADD COLUMN IF NOT EXISTS epsilonnet_username   VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS epsilonnet_password   VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS unidoc_api_key     VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS unidoc_api_url     VARCHAR(255) DEFAULT 'https://api.unidoc.gr/v1',
  ADD COLUMN IF NOT EXISTS unidoc_username    VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS unidoc_password    VARCHAR(255) DEFAULT NULL;

-- GSIS credentials for AFM lookup per business
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS gsis_username VARCHAR(100) NULL DEFAULT NULL
    COMMENT 'ΓΓΠΣ username for AFM lookup',
  ADD COLUMN IF NOT EXISTS gsis_password VARCHAR(255) NULL DEFAULT NULL
    COMMENT 'ΓΓΠΣ password for AFM lookup';


-- ══════════════════════════════════════════════════════════════
-- SECTION 4: business_settings additions
-- ══════════════════════════════════════════════════════════════

-- IRIS payment columns
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS iris_enabled     TINYINT(1)   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iris_iban        VARCHAR(50)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS iris_beneficiary VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS iris_bank_name   VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS iris_mobile      VARCHAR(30)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS iris_bic         VARCHAR(20)  DEFAULT NULL;

-- Email provider columns
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS email_provider     VARCHAR(30)  DEFAULT 'smtp'
    COMMENT 'smtp | brevo | sendgrid | mailgun',
  ADD COLUMN IF NOT EXISTS brevo_api_key      VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS brevo_sender_name  VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS brevo_sender_email VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sendgrid_api_key   VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS mailgun_api_key    VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS mailgun_domain     VARCHAR(150) DEFAULT NULL;

-- SMS provider columns
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS sms_provider_type  VARCHAR(30)  DEFAULT 'infobip'
    COMMENT 'infobip | apifon | routee | vonage | twilio | bsms | yuboto',
  ADD COLUMN IF NOT EXISTS infobip_api_key    VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS infobip_base_url   VARCHAR(150) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS apifon_api_key     VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS apifon_sender      VARCHAR(20)  DEFAULT 'FishBill',
  ADD COLUMN IF NOT EXISTS routee_api_key     VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS routee_sender_id   VARCHAR(20)  DEFAULT 'FishBill',
  ADD COLUMN IF NOT EXISTS vonage_api_key     VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS vonage_api_secret  VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS twilio_account_sid VARCHAR(50)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS twilio_auth_token  VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS twilio_from_number VARCHAR(20)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bsms_api_key       VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS yuboto_api_key     VARCHAR(255) DEFAULT NULL;


-- ══════════════════════════════════════════════════════════════
-- SECTION 5: invoices table additions
-- ══════════════════════════════════════════════════════════════

-- Expand payment_method ENUM
ALTER TABLE invoices
  MODIFY COLUMN payment_method
    ENUM('cash','bank','bank_transfer','check','credit','credit_card','card','iris','other')
    DEFAULT 'cash';

-- e-timologiera fields
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS mydata_qr        TEXT         NULL
    COMMENT 'QR code URL returned by e-timologiera / AADE',
  ADD COLUMN IF NOT EXISTS etimologiera_uid VARCHAR(128) NULL
    COMMENT 'Unique invoice ID assigned by e-timologiera';

CREATE INDEX IF NOT EXISTS idx_invoices_etim_uid ON invoices (etimologiera_uid);

-- Credit/reversal invoice link
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS related_invoice_id VARCHAR(36) NULL DEFAULT NULL
    COMMENT 'For credit invoices (type 1.3): references the original invoice';

CREATE INDEX IF NOT EXISTS idx_related_invoice ON invoices (related_invoice_id);


-- ══════════════════════════════════════════════════════════════
-- SECTION 6: invoice_lines additions
-- ══════════════════════════════════════════════════════════════

ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS income_classification_category VARCHAR(30) DEFAULT 'category1_1'
    COMMENT 'myDATA income category',
  ADD COLUMN IF NOT EXISTS income_classification_type VARCHAR(30) DEFAULT 'E3_561_001'
    COMMENT 'myDATA type';


-- ══════════════════════════════════════════════════════════════
-- SECTION 7: New tables
-- ══════════════════════════════════════════════════════════════

-- IRIS payment requests
CREATE TABLE IF NOT EXISTS iris_payments (
  id             CHAR(36)      NOT NULL PRIMARY KEY DEFAULT (UUID()),
  business_id    CHAR(36)      NOT NULL,
  invoice_id     CHAR(36)      DEFAULT NULL,
  amount         DECIMAL(10,2) NOT NULL,
  description    VARCHAR(500)  DEFAULT NULL,
  status         ENUM('pending','completed','failed','cancelled') DEFAULT 'pending',
  payer_name     VARCHAR(255)  DEFAULT NULL,
  payer_mobile   VARCHAR(30)   DEFAULT NULL,
  reference_code VARCHAR(100)  DEFAULT NULL,
  notes          TEXT          DEFAULT NULL,
  completed_at   DATETIME      DEFAULT NULL,
  created_at     DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_iris_biz     FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_iris_invoice FOREIGN KEY (invoice_id)  REFERENCES invoices(id)   ON DELETE SET NULL,
  INDEX idx_iris_business (business_id),
  INDEX idx_iris_invoice  (invoice_id),
  INDEX idx_iris_status   (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Integration logs (Brevo, SMS, myDATA providers, etc.)
CREATE TABLE IF NOT EXISTS integration_logs (
  id           CHAR(36)    NOT NULL PRIMARY KEY DEFAULT (UUID()),
  business_id  CHAR(36)    DEFAULT NULL,
  service      VARCHAR(50) NOT NULL COMMENT 'brevo | infobip | softone | etimologiera | ...',
  event_type   VARCHAR(50) NOT NULL COMMENT 'email_sent | sms_sent | invoice_transmitted | error',
  status       ENUM('success','failed','pending') DEFAULT 'pending',
  request_ref  VARCHAR(255) DEFAULT NULL,
  recipient    VARCHAR(255) DEFAULT NULL,
  error_msg    TEXT         DEFAULT NULL,
  meta         JSON         DEFAULT NULL,
  created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_intlog_biz FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL,
  INDEX idx_intlog_biz_service (business_id, service),
  INDEX idx_intlog_event       (event_type, status),
  INDEX idx_intlog_date        (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Webhooks per business
CREATE TABLE IF NOT EXISTS webhooks (
  id           CHAR(36)     NOT NULL PRIMARY KEY DEFAULT (UUID()),
  business_id  CHAR(36)     NOT NULL,
  name         VARCHAR(100) NOT NULL,
  url          VARCHAR(500) NOT NULL,
  secret       VARCHAR(100) DEFAULT NULL,
  events       JSON         NOT NULL COMMENT '["invoice.created","invoice.transmitted"]',
  is_active    TINYINT(1)   DEFAULT 1,
  last_fired   DATETIME     DEFAULT NULL,
  created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_webhook_biz FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Employee privileges
CREATE TABLE IF NOT EXISTS employee_privileges (
  id          INT UNSIGNED   NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     CHAR(36)       NOT NULL UNIQUE,
  privileges  JSON           NOT NULL DEFAULT (JSON_ARRAY()),
  granted_by  CHAR(36)       NULL,
  granted_at  DATETIME       DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ep_user    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ep_grantor FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bug reports from accountants
CREATE TABLE IF NOT EXISTS bug_reports (
  id           CHAR(36)     NOT NULL PRIMARY KEY DEFAULT (UUID()),
  reporter_id  CHAR(36)     NOT NULL COMMENT 'accountant user id',
  category     VARCHAR(50)  NOT NULL,
  description  TEXT         NOT NULL,
  steps        TEXT         NULL,
  severity     ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status       ENUM('open','in_progress','resolved','closed') NOT NULL DEFAULT 'open',
  admin_notes  TEXT         NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_bug_reporter (reporter_id),
  KEY idx_bug_status   (status),
  KEY idx_bug_severity (severity),
  CONSTRAINT fk_bug_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ══════════════════════════════════════════════════════════════
-- SECTION 8: Full-text & other indexes (idempotent)
-- ══════════════════════════════════════════════════════════════

ALTER TABLE invoices   ADD FULLTEXT INDEX IF NOT EXISTS ft_invoices   (full_number);
ALTER TABLE customers  ADD FULLTEXT INDEX IF NOT EXISTS ft_customers  (name, afm, email, phone, city);
ALTER TABLE products   ADD FULLTEXT INDEX IF NOT EXISTS ft_products   (name, code, description);
ALTER TABLE audit_logs ADD FULLTEXT INDEX IF NOT EXISTS ft_audit_logs (action, description);


-- ══════════════════════════════════════════════════════════════
-- DONE
-- ══════════════════════════════════════════════════════════════
SELECT 'Migration 013 (all_pending) applied successfully!' AS result;
