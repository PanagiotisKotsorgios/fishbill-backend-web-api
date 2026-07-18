-- Αγρότης initial schema — all tables prefixed with `ag_` to guarantee
-- zero collision with FishBill tables on a shared database.
-- Safe to run against a fresh DB; skips existing tables via IF NOT EXISTS.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE IF NOT EXISTS ag_businesses (
  id            CHAR(36) NOT NULL PRIMARY KEY,
  name          VARCHAR(200) NOT NULL,
  afm           VARCHAR(20) NOT NULL,
  doy           VARCHAR(200) NULL,
  address       VARCHAR(200) NULL,
  city          VARCHAR(100) NULL,
  postal_code   VARCHAR(20)  NULL,
  phone         VARCHAR(50)  NULL,
  email         VARCHAR(200) NULL,
  iban          VARCHAR(50)  NULL,
  activity      VARCHAR(200) NULL,
  wrapp_partner_email VARCHAR(200) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ag_businesses_afm (afm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ag_users (
  id             CHAR(36) NOT NULL PRIMARY KEY,
  business_id    CHAR(36) NOT NULL,
  name           VARCHAR(200) NOT NULL,
  email          VARCHAR(200) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  role           VARCHAR(30) NOT NULL DEFAULT 'owner',
  phone          VARCHAR(50)  NULL,
  avatar_url     VARCHAR(500) NULL,
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  email_verify_token   VARCHAR(255) NULL,
  email_verify_expires DATETIME NULL,
  last_login_at  DATETIME NULL,
  last_login_ip  VARCHAR(45) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ag_users_email (email),
  KEY idx_ag_users_business (business_id),
  CONSTRAINT fk_ag_users_business FOREIGN KEY (business_id)
    REFERENCES ag_businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ag_admins (
  id             CHAR(36) NOT NULL PRIMARY KEY,
  name           VARCHAR(200) NOT NULL,
  email          VARCHAR(200) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  role           VARCHAR(30) NOT NULL DEFAULT 'admin',   -- admin | superadmin
  last_login_at  DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ag_admins_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ag_customers (
  id            CHAR(36) NOT NULL PRIMARY KEY,
  business_id   CHAR(36) NOT NULL,
  name          VARCHAR(200) NOT NULL,
  afm           VARCHAR(20)  NULL,
  doy           VARCHAR(200) NULL,
  country_code  CHAR(2) NOT NULL DEFAULT 'GR',
  street        VARCHAR(200) NULL,
  number        VARCHAR(20)  NULL,
  city          VARCHAR(100) NULL,
  postal_code   VARCHAR(20)  NULL,
  phone         VARCHAR(50)  NULL,
  email         VARCHAR(200) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ag_customers_business (business_id),
  CONSTRAINT fk_ag_customers_business FOREIGN KEY (business_id)
    REFERENCES ag_businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ag_invoices (
  id                     CHAR(36) NOT NULL PRIMARY KEY,
  business_id            CHAR(36) NOT NULL,
  invoice_type           VARCHAR(10) NOT NULL,
  billing_book_id        VARCHAR(100) NULL,
  customer_name          VARCHAR(200) NOT NULL,
  customer_afm           VARCHAR(20) NULL,
  customer_city          VARCHAR(100) NULL,
  customer_street        VARCHAR(200) NULL,
  customer_number        VARCHAR(20) NULL,
  customer_postal_code   VARCHAR(20) NULL,
  customer_email         VARCHAR(200) NULL,
  net_total_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  vat_total_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount           DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method_type    TINYINT NOT NULL DEFAULT 0,
  payment_details        VARCHAR(500) NULL,
  notes                  TEXT NULL,
  my_data_mark           VARCHAR(100) NULL,
  my_data_uid            VARCHAR(100) NULL,
  wrapp_qr_url           VARCHAR(500) NULL,
  wrapp_invoice_url      VARCHAR(500) NULL,
  pdf_url                VARCHAR(500) NULL,
  series                 VARCHAR(20) NULL,
  num                    INT NULL,
  cancelled_by_mark      VARCHAR(100) NULL,
  cancelled_at           DATETIME NULL,
  draft                  TINYINT(1) NOT NULL DEFAULT 0,
  created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ag_invoices_business (business_id),
  KEY idx_ag_invoices_created  (created_at),
  KEY idx_ag_invoices_mark     (my_data_mark),
  CONSTRAINT fk_ag_invoices_business FOREIGN KEY (business_id)
    REFERENCES ag_businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ag_invoice_lines (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_id               CHAR(36) NOT NULL,
  line_number              INT NOT NULL,
  name                     VARCHAR(200) NOT NULL,
  code                     VARCHAR(100) NULL,
  description              VARCHAR(500) NULL,
  quantity                 DECIMAL(12,4) NOT NULL,
  quantity_type            TINYINT NOT NULL DEFAULT 2,
  unit_price               DECIMAL(12,4) NOT NULL,
  net_total_price          DECIMAL(12,2) NOT NULL,
  vat_rate                 DECIMAL(5,2) NOT NULL,
  vat_total                DECIMAL(12,2) NOT NULL,
  subtotal                 DECIMAL(12,2) NOT NULL,
  vat_exemption_code       INT NULL,
  classification_category  VARCHAR(50) NOT NULL,
  classification_type      VARCHAR(50) NOT NULL,
  KEY idx_ag_invoice_lines_invoice (invoice_id),
  CONSTRAINT fk_ag_invoice_lines_invoice FOREIGN KEY (invoice_id)
    REFERENCES ag_invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ag_delivery_notes (
  id                             CHAR(36) NOT NULL PRIMARY KEY,
  business_id                    CHAR(36) NOT NULL,
  billing_book_id                VARCHAR(100) NULL,
  customer_name                  VARCHAR(200) NOT NULL,
  customer_afm                   VARCHAR(20) NULL,
  dispatch_date                  VARCHAR(20) NOT NULL,
  dispatch_time                  VARCHAR(10) NOT NULL,
  vehicle_number                 VARCHAR(30) NOT NULL,
  purpose_of_movement            TINYINT NOT NULL,
  purpose_of_movement_custom_title VARCHAR(200) NULL,
  issuer_of_movement             VARCHAR(200) NOT NULL,
  from_address                   VARCHAR(200) NOT NULL,
  from_number                    VARCHAR(20)  NOT NULL,
  from_city                      VARCHAR(100) NOT NULL,
  from_zipcode                   VARCHAR(20)  NOT NULL,
  to_address                     VARCHAR(200) NOT NULL,
  to_number                      VARCHAR(20)  NOT NULL,
  to_city                        VARCHAR(100) NOT NULL,
  to_zipcode                     VARCHAR(20)  NOT NULL,
  my_data_mark                   VARCHAR(100) NULL,
  my_data_uid                    VARCHAR(100) NULL,
  wrapp_qr_url                   VARCHAR(500) NULL,
  pdf_url                        VARCHAR(500) NULL,
  series                         VARCHAR(20) NULL,
  num                            INT NULL,
  cancelled_by_mark              VARCHAR(100) NULL,
  cancelled_at                   DATETIME NULL,
  draft                          TINYINT(1) NOT NULL DEFAULT 0,
  created_at                     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ag_dn_business (business_id),
  KEY idx_ag_dn_created  (created_at),
  KEY idx_ag_dn_mark     (my_data_mark),
  CONSTRAINT fk_ag_dn_business FOREIGN KEY (business_id)
    REFERENCES ag_businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ag_delivery_note_lines (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dn_id                    CHAR(36) NOT NULL,
  line_number              INT NOT NULL,
  name                     VARCHAR(200) NOT NULL,
  code                     VARCHAR(100) NULL,
  quantity                 DECIMAL(12,4) NOT NULL,
  quantity_type            TINYINT NOT NULL DEFAULT 2,
  unit_price               DECIMAL(12,4) NOT NULL DEFAULT 0,
  net_total_price          DECIMAL(12,2) NOT NULL DEFAULT 0,
  vat_rate                 DECIMAL(5,2)  NOT NULL DEFAULT 0,
  vat_total                DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal                 DECIMAL(12,2) NOT NULL DEFAULT 0,
  classification_category  VARCHAR(50) NOT NULL,
  classification_type      VARCHAR(50) NOT NULL,
  KEY idx_ag_dn_lines_dn (dn_id),
  CONSTRAINT fk_ag_dn_lines_dn FOREIGN KEY (dn_id)
    REFERENCES ag_delivery_notes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ag_subscriptions (
  business_id            CHAR(36) NOT NULL PRIMARY KEY,
  plan                   VARCHAR(30) NOT NULL DEFAULT 'trial',
  status                 VARCHAR(30) NOT NULL DEFAULT 'trial',
  current_period_end     DATETIME NULL,
  docs_used_this_period  INT NOT NULL DEFAULT 0,
  docs_limit_this_period INT NOT NULL DEFAULT 50,
  created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ag_subs_business FOREIGN KEY (business_id)
    REFERENCES ag_businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ag_weighing_slips (
  id            CHAR(36) NOT NULL PRIMARY KEY,
  business_id   CHAR(36) NOT NULL,
  product_type  VARCHAR(200) NOT NULL,
  fao_code      VARCHAR(20) NULL,
  weight_kg     DECIMAL(10,3) NOT NULL,
  individual_count INT NULL,
  presentation_code VARCHAR(20) NULL,
  slip_date     VARCHAR(20) NOT NULL,
  buyer_name    VARCHAR(200) NULL,
  photo_url     VARCHAR(500) NULL,
  notes         TEXT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ag_slips_business (business_id),
  CONSTRAINT fk_ag_slips_business FOREIGN KEY (business_id)
    REFERENCES ag_businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ag_wrapp_logs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_id   CHAR(36) NULL,
  event_type    VARCHAR(80) NOT NULL,
  direction     ENUM('outbound','inbound') NOT NULL,
  endpoint      VARCHAR(200) NULL,
  request_body  MEDIUMTEXT NULL,
  response_body MEDIUMTEXT NULL,
  status_code   INT NULL,
  error_message VARCHAR(500) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ag_wrapp_logs_business (business_id),
  KEY idx_ag_wrapp_logs_created  (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
