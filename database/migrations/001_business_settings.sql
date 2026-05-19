-- FishBill Migration 001 — Business Settings & Indexes
-- Run against fishbill_db

USE fishbill_db;

-- Settings table (extends businesses with per-business config)
CREATE TABLE IF NOT EXISTS business_settings (
    id              CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    business_id     CHAR(36) NOT NULL UNIQUE,
    -- Email / SMTP
    smtp_host       VARCHAR(255) NULL,
    smtp_port       SMALLINT     DEFAULT 587,
    smtp_user       VARCHAR(255) NULL,
    smtp_pass       TEXT         NULL,
    smtp_from_name  VARCHAR(255) NULL,
    smtp_from_email VARCHAR(255) NULL,
    smtp_secure     TINYINT(1)   DEFAULT 0,
    email_enabled   TINYINT(1)   DEFAULT 0,
    -- SMS
    sms_provider    VARCHAR(50)  NULL COMMENT 'twilio|nexmo|custom',
    sms_api_key     TEXT         NULL,
    sms_api_secret  TEXT         NULL,
    sms_from        VARCHAR(50)  NULL,
    sms_enabled     TINYINT(1)   DEFAULT 0,
    -- Notifications (1=enabled)
    notif_invoice_created     TINYINT(1) DEFAULT 1,
    notif_invoice_transmitted TINYINT(1) DEFAULT 1,
    notif_invoice_failed      TINYINT(1) DEFAULT 1,
    notif_daily_summary       TINYINT(1) DEFAULT 0,
    -- Appearance
    theme_accent    VARCHAR(20)  DEFAULT 'blue',
    -- Invoice defaults
    invoice_footer  TEXT         NULL,
    default_due_days INT         DEFAULT 30,
    auto_transmit   TINYINT(1)   DEFAULT 0,
    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Full-text search indexes for fast global search
ALTER TABLE invoices   ADD FULLTEXT INDEX IF NOT EXISTS ft_invoices   (full_number) ;
ALTER TABLE customers  ADD FULLTEXT INDEX IF NOT EXISTS ft_customers  (name, afm, email, phone, city);
ALTER TABLE products   ADD FULLTEXT INDEX IF NOT EXISTS ft_products   (name, code, description);
ALTER TABLE audit_logs ADD FULLTEXT INDEX IF NOT EXISTS ft_audit_logs (action, description);
