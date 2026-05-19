-- =============================================================================
-- FishBill Database Schema
-- MySQL 8.0+
-- Run this in MySQL Workbench against the fishbill_db database
-- =============================================================================

CREATE DATABASE IF NOT EXISTS fishbill_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE fishbill_db;

-- =============================================================================
-- businesses
-- Each fisherman/company registered on the platform
-- =============================================================================
CREATE TABLE IF NOT EXISTS businesses (
    id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    afm           VARCHAR(9)   NOT NULL UNIQUE COMMENT 'Tax ID',
    name          VARCHAR(255) NOT NULL COMMENT 'Company name',
    trade_name    VARCHAR(255) NULL COMMENT 'Trade name',
    doy           VARCHAR(100) NULL COMMENT 'Tax office',
    address       TEXT         NULL,
    city          VARCHAR(100) NULL,
    postal_code   VARCHAR(5)   NULL,
    phone         VARCHAR(20)  NULL,
    email         VARCHAR(255) NULL,
    activity_code VARCHAR(10)  NULL DEFAULT '03.11',
    vat_regime    ENUM('normal','small_business','exempt') DEFAULT 'normal',
    invoice_series    VARCHAR(10) DEFAULT 'A',
    invoice_counter   INT         DEFAULT 0,
    receipt_series    VARCHAR(10) DEFAULT 'B',
    receipt_counter   INT         DEFAULT 0,
    mydata_user_id        VARCHAR(100) NULL,
    mydata_subscription_key TEXT NULL,
    provider_name         VARCHAR(50)  NULL,
    provider_api_key      TEXT         NULL,
    provider_api_url      VARCHAR(255) NULL,
    provider_username     VARCHAR(100) NULL,
    provider_password     TEXT         NULL,
    plan          ENUM('trial','basic','pro','enterprise') DEFAULT 'trial',
    trial_ends_at DATETIME NULL,
    subscription_active TINYINT(1) DEFAULT 0,
    subscription_ends_at DATETIME NULL,
    stripe_customer_id  VARCHAR(100) NULL,
    is_active     TINYINT(1) DEFAULT 1,
    is_suspended  TINYINT(1) DEFAULT 0,
    suspend_reason VARCHAR(255) NULL,
    accountant_name  VARCHAR(255) NULL,
    accountant_email VARCHAR(255) NULL,
    accountant_phone VARCHAR(20)  NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_afm (afm),
    INDEX idx_plan (plan),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- users
-- Roles: super_admin, owner, accountant, captain, employee
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    business_id   CHAR(36)     NULL,
    full_name     VARCHAR(255) NOT NULL,
    email         VARCHAR(255) NULL UNIQUE,
    phone         VARCHAR(20)  NULL,
    phone_verified TINYINT(1)  DEFAULT 0,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('super_admin','owner','accountant','captain','employee') NOT NULL DEFAULT 'owner',
    can_create_invoice TINYINT(1) DEFAULT 1,
    can_cancel_invoice TINYINT(1) DEFAULT 0,
    can_view_all       TINYINT(1) DEFAULT 0,
    can_export         TINYINT(1) DEFAULT 0,
    can_manage_users   TINYINT(1) DEFAULT 0,
    can_view_logs      TINYINT(1) DEFAULT 0,
    last_login_at   DATETIME NULL,
    last_login_ip   VARCHAR(45) NULL,
    is_active       TINYINT(1) DEFAULT 1,
    email_verified  TINYINT(1) DEFAULT 0,
    reset_token          VARCHAR(100) NULL,
    reset_token_expires  DATETIME NULL,
    invite_token         VARCHAR(100) NULL,
    invite_expires       DATETIME NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL,
    INDEX idx_business (business_id),
    INDEX idx_email (email),
    INDEX idx_role (role),
    INDEX idx_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- customers
-- Customers per business
-- =============================================================================
CREATE TABLE IF NOT EXISTS customers (
    id          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    business_id CHAR(36)     NOT NULL,
    afm         VARCHAR(9)   NULL COMMENT 'Tax ID (for B2B)',
    name        VARCHAR(255) NOT NULL,
    trade_name  VARCHAR(255) NULL,
    address     TEXT         NULL,
    city        VARCHAR(100) NULL,
    postal_code VARCHAR(5)   NULL,
    country     CHAR(2)      DEFAULT 'GR',
    phone       VARCHAR(20)  NULL,
    email       VARCHAR(255) NULL,
    default_payment_method ENUM('cash','bank','check','credit') DEFAULT 'cash',
    is_favorite   TINYINT(1) DEFAULT 0,
    is_active     TINYINT(1) DEFAULT 1,
    total_invoices   INT         DEFAULT 0,
    total_amount     DECIMAL(12,2) DEFAULT 0.00,
    last_invoice_at  DATETIME NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
    INDEX idx_business (business_id),
    INDEX idx_afm (afm),
    INDEX idx_name (name),
    INDEX idx_favorite (is_favorite)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- products
-- Fish species / items per business
-- =============================================================================
CREATE TABLE IF NOT EXISTS products (
    id          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    business_id CHAR(36)     NOT NULL,
    name        VARCHAR(255) NOT NULL COMMENT 'e.g. Sea Bream, Bass',
    code        VARCHAR(50)  NULL,
    description TEXT         NULL,
    unit        VARCHAR(20)  DEFAULT 'KG',
    default_price DECIMAL(10,4) NULL,
    vat_rate      TINYINT     DEFAULT 13,
    income_category VARCHAR(20) DEFAULT 'E3_561_001',
    income_type     VARCHAR(10) DEFAULT '1.1',
    is_favorite TINYINT(1) DEFAULT 0,
    is_active   TINYINT(1) DEFAULT 1,
    sort_order  INT DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
    INDEX idx_business (business_id),
    INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- invoice_series
-- Invoice numbering series per business
-- =============================================================================
CREATE TABLE IF NOT EXISTS invoice_series (
    id          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    business_id CHAR(36)     NOT NULL,
    series      VARCHAR(10)  NOT NULL,
    description VARCHAR(100) NULL,
    invoice_type VARCHAR(10) DEFAULT '1.1',
    current_number INT DEFAULT 0,
    is_default  TINYINT(1) DEFAULT 0,
    is_active   TINYINT(1) DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_series (business_id, series)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- invoices
-- Main invoices table
-- =============================================================================
CREATE TABLE IF NOT EXISTS invoices (
    id          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    business_id CHAR(36)     NOT NULL,
    customer_id CHAR(36)     NULL,
    created_by  CHAR(36)     NULL,
    series      VARCHAR(10)  NOT NULL,
    number      INT          NOT NULL,
    full_number VARCHAR(50)  NOT NULL,
    invoice_type VARCHAR(10) DEFAULT '1.1',
    issue_date  DATE         NOT NULL DEFAULT (CURDATE()),
    issue_time  TIME         NOT NULL DEFAULT (CURTIME()),
    due_date    DATE         NULL,
    payment_method ENUM('cash','bank','check','credit','other') DEFAULT 'cash',
    net_value   DECIMAL(12,2) DEFAULT 0.00,
    vat_amount  DECIMAL(12,2) DEFAULT 0.00,
    total_value DECIMAL(12,2) DEFAULT 0.00,
    discount_amount DECIMAL(12,2) DEFAULT 0.00,
    status ENUM('draft','issued','pending_retry','transmitted','failed','cancelled') DEFAULT 'draft',
    mydata_mark       VARCHAR(50)  NULL,
    mydata_uid        VARCHAR(100) NULL,
    mydata_cancel_mark VARCHAR(50) NULL,
    provider_name     VARCHAR(50)  NULL,
    provider_reference VARCHAR(100) NULL,
    retry_count       INT DEFAULT 0,
    next_retry_at     DATETIME NULL,
    last_error        TEXT NULL,
    pdf_path          VARCHAR(500) NULL,
    pdf_generated_at  DATETIME NULL,
    transmitted_at    DATETIME NULL,
    cancelled_at      DATETIME NULL,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (business_id) REFERENCES businesses(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE KEY uniq_invoice (business_id, series, number),
    INDEX idx_business (business_id),
    INDEX idx_status (status),
    INDEX idx_date (issue_date),
    INDEX idx_mark (mydata_mark),
    INDEX idx_customer (customer_id),
    INDEX idx_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- invoice_lines
-- Line items for each invoice
-- =============================================================================
CREATE TABLE IF NOT EXISTS invoice_lines (
    id          CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    invoice_id  CHAR(36)     NOT NULL,
    product_id  CHAR(36)     NULL,
    line_number INT          NOT NULL DEFAULT 1,
    description VARCHAR(500) NOT NULL,
    unit        VARCHAR(20)  DEFAULT 'KG',
    quantity    DECIMAL(10,3) NOT NULL,
    unit_price  DECIMAL(10,4) NOT NULL,
    discount_pct  DECIMAL(5,2) DEFAULT 0.00,
    discount_amt  DECIMAL(10,2) DEFAULT 0.00,
    net_value   DECIMAL(12,2) NOT NULL,
    vat_rate    TINYINT      NOT NULL DEFAULT 13,
    vat_amount  DECIMAL(12,2) NOT NULL,
    total_value DECIMAL(12,2) NOT NULL,
    income_category VARCHAR(20) DEFAULT 'E3_561_001',
    income_type     VARCHAR(10) DEFAULT '1.1',
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
    INDEX idx_invoice (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- transmission_logs
-- Every attempt to send to provider/myDATA
-- =============================================================================
CREATE TABLE IF NOT EXISTS transmission_logs (
    id              CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    invoice_id      CHAR(36)    NOT NULL,
    provider        VARCHAR(50) NULL,
    attempt_number  INT         DEFAULT 1,
    request_url     VARCHAR(500) NULL,
    request_payload LONGTEXT    NULL,
    http_status     SMALLINT    NULL,
    response_body   LONGTEXT    NULL,
    success         TINYINT(1)  DEFAULT 0,
    mydata_mark     VARCHAR(50) NULL,
    error_message   TEXT        NULL,
    duration_ms     INT         NULL,
    attempted_at    DATETIME    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    INDEX idx_invoice (invoice_id),
    INDEX idx_success (success),
    INDEX idx_date (attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- audit_logs
-- Immutable activity history (append-only)
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id     CHAR(36)     NULL,
    business_id CHAR(36)     NULL,
    action      VARCHAR(50)  NOT NULL,
    entity_type VARCHAR(50)  NULL,
    entity_id   CHAR(36)     NULL,
    description TEXT         NULL,
    old_values  JSON         NULL,
    new_values  JSON         NULL,
    ip_address  VARCHAR(45)  NULL,
    user_agent  VARCHAR(500) NULL,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_business (business_id),
    INDEX idx_action (action),
    INDEX idx_entity (entity_type, entity_id),
    INDEX idx_date (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- backup_logs
-- Backup history
-- =============================================================================
CREATE TABLE IF NOT EXISTS backup_logs (
    id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    filename    VARCHAR(255) NOT NULL,
    size_bytes  BIGINT       NULL,
    type        ENUM('auto','manual') DEFAULT 'auto',
    status      ENUM('running','success','failed') DEFAULT 'running',
    error_msg   TEXT         NULL,
    started_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME     NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- subscriptions
-- Plans and payments
-- =============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
    id              CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    business_id     CHAR(36)    NOT NULL UNIQUE,
    plan            ENUM('basic','pro','enterprise') DEFAULT 'basic',
    price_eur       DECIMAL(8,2) DEFAULT 10.00,
    billing_cycle   ENUM('monthly','annual') DEFAULT 'monthly',
    stripe_sub_id           VARCHAR(100) NULL,
    stripe_payment_method   VARCHAR(100) NULL,
    status ENUM('active','past_due','cancelled','trial') DEFAULT 'trial',
    trial_ends_at   DATETIME NULL,
    current_period_start DATETIME NULL,
    current_period_end   DATETIME NULL,
    cancelled_at    DATETIME NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- notifications
-- System notifications for users
-- =============================================================================
CREATE TABLE IF NOT EXISTS notifications (
    id          CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    user_id     CHAR(36)    NOT NULL,
    type        VARCHAR(50) NOT NULL,
    title       VARCHAR(255) NOT NULL,
    message     TEXT        NULL,
    is_read     TINYINT(1)  DEFAULT 0,
    action_url  VARCHAR(500) NULL,
    created_at  DATETIME    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_unread (user_id, is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- Default super admin user
-- Password: Admin@123 (change immediately after first login)
-- Hash generated with bcrypt rounds=12
-- =============================================================================
INSERT INTO users (id, full_name, email, password_hash, role, is_active, email_verified, can_view_all, can_manage_users, can_view_logs, can_export)
VALUES (
    UUID(),
    'Super Admin',
    'admin@fishbill.gr',
    '$2b$12$Gil9s7yeIoHwmYnTGBbdzuzNzIgq/8eRRVJoe7iuv7PLL4/YBpWKm',
    'super_admin',
    1,
    1,
    1,
    1,
    1,
    1
);

-- =============================================================================
-- Default fish products (common Greek fish species)
-- Will be seeded per business on registration
-- =============================================================================
-- Note: products are per-business, so they are created via API on registration

SELECT 'FishBill schema created successfully!' AS result;
