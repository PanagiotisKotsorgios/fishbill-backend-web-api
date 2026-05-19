-- ============================================================
-- Migration 005: Third-party integrations
-- Brevo (email), Infobip/Apifon/Routee (SMS),
-- SoftOne/EpsilonNet/UniDoc (myDATA providers)
-- ============================================================

-- ── Email provider columns ────────────────────────────────────────────────────
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS email_provider    VARCHAR(30)   DEFAULT 'smtp'   COMMENT 'smtp | brevo | sendgrid | mailgun',
  ADD COLUMN IF NOT EXISTS brevo_api_key     VARCHAR(255)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS brevo_sender_name VARCHAR(100)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS brevo_sender_email VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sendgrid_api_key  VARCHAR(255)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS mailgun_api_key   VARCHAR(255)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS mailgun_domain    VARCHAR(150)  DEFAULT NULL;

-- ── SMS provider columns ──────────────────────────────────────────────────────
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS sms_provider_type VARCHAR(30)   DEFAULT 'infobip' COMMENT 'infobip | apifon | routee | vonage | twilio | bsms | yuboto',
  ADD COLUMN IF NOT EXISTS infobip_api_key   VARCHAR(255)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS infobip_base_url  VARCHAR(150)  DEFAULT NULL      COMMENT 'e.g. xxxxx.api.infobip.com',
  ADD COLUMN IF NOT EXISTS apifon_api_key    VARCHAR(255)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS apifon_sender     VARCHAR(20)   DEFAULT 'FishBill',
  ADD COLUMN IF NOT EXISTS routee_api_key    VARCHAR(255)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS routee_sender_id  VARCHAR(20)   DEFAULT 'FishBill',
  ADD COLUMN IF NOT EXISTS vonage_api_key    VARCHAR(100)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS vonage_api_secret VARCHAR(100)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS twilio_account_sid VARCHAR(50)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS twilio_auth_token VARCHAR(100)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS twilio_from_number VARCHAR(20)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bsms_api_key      VARCHAR(255)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS yuboto_api_key    VARCHAR(255)  DEFAULT NULL;

-- ── myDATA provider columns ───────────────────────────────────────────────────
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS mydata_provider   VARCHAR(30)   DEFAULT 'direct'  COMMENT 'direct | softone | epsilonnet | unidoc | entersoft | singular | megasoft',
  ADD COLUMN IF NOT EXISTS softone_api_key   VARCHAR(255)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS softone_api_url   VARCHAR(255)  DEFAULT 'https://api.softone.gr/api/mydata',
  ADD COLUMN IF NOT EXISTS softone_username  VARCHAR(100)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS softone_password  VARCHAR(255)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS softone_company_id VARCHAR(50)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS epsilonnet_api_key   VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS epsilonnet_api_url   VARCHAR(255) DEFAULT 'https://mydata.epsilonnet.gr/api',
  ADD COLUMN IF NOT EXISTS epsilonnet_username  VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS epsilonnet_password  VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS unidoc_api_key    VARCHAR(255)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS unidoc_api_url    VARCHAR(255)  DEFAULT 'https://api.unidoc.gr/v1',
  ADD COLUMN IF NOT EXISTS unidoc_username   VARCHAR(100)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS unidoc_password   VARCHAR(255)  DEFAULT NULL;

-- ── Integration logs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_logs (
  id           CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  business_id  CHAR(36)     DEFAULT NULL,
  service      VARCHAR(50)  NOT NULL   COMMENT 'brevo | infobip | apifon | softone | epsilonnet | unidoc | ...',
  event_type   VARCHAR(50)  NOT NULL   COMMENT 'email_sent | sms_sent | invoice_transmitted | test_connection | error',
  status       ENUM('success','failed','pending') DEFAULT 'pending',
  request_ref  VARCHAR(255) DEFAULT NULL COMMENT 'external reference/message ID',
  recipient    VARCHAR(255) DEFAULT NULL COMMENT 'email address or phone number',
  error_msg    TEXT         DEFAULT NULL,
  meta         JSON         DEFAULT NULL COMMENT 'extra data: invoice_id, template_id, cost_units, etc.',
  created_at   DATETIME     DEFAULT NOW(),
  CONSTRAINT fk_intlog_biz FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL,
  INDEX idx_intlog_biz_service (business_id, service),
  INDEX idx_intlog_event (event_type, status),
  INDEX idx_intlog_date (created_at)
);

-- ── Webhook endpoints ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
  id           CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  business_id  CHAR(36)     NOT NULL,
  name         VARCHAR(100) NOT NULL,
  url          VARCHAR(500) NOT NULL,
  secret       VARCHAR(100) DEFAULT NULL COMMENT 'HMAC secret for signature verification',
  events       JSON         NOT NULL    COMMENT '["invoice.created","invoice.transmitted","payment.received"]',
  is_active    TINYINT(1)   DEFAULT 1,
  last_fired   DATETIME     DEFAULT NULL,
  created_at   DATETIME     DEFAULT NOW(),
  updated_at   DATETIME     DEFAULT NOW() ON UPDATE NOW(),
  CONSTRAINT fk_webhook_biz FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
