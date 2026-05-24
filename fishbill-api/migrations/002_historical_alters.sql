-- =============================================================================
-- FishBill Migration 002 — Historical ALTER statements (idempotent)
-- All statements are safe to re-run on existing databases.
-- Uses IF NOT EXISTS / INFORMATION_SCHEMA guards throughout.
-- Do NOT add USE statements — the runner connects to the correct DB directly.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- users: is_verified column
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_verified TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Accountant verification status. 0=pending, 1=verified by super_admin.'
  AFTER is_active;

UPDATE users SET is_verified = 1 WHERE role IN ('super_admin', 'owner') AND is_verified = 0;

-- ---------------------------------------------------------------------------
-- users: accountant notification columns
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notif_new_invoice  TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Email on new invoice from client',
  ADD COLUMN IF NOT EXISTS notif_mydata_fail  TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Email on myDATA transmission failure',
  ADD COLUMN IF NOT EXISTS notif_client_new   TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Email when new client links accountant',
  ADD COLUMN IF NOT EXISTS notif_subscription TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Email for subscription updates';

-- ---------------------------------------------------------------------------
-- users: verification request tracking
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verification_requested_at DATETIME NULL
    COMMENT 'When accountant submitted verification request'
  AFTER is_verified,
  ADD COLUMN IF NOT EXISTS verification_data JSON NULL
    COMMENT 'JSON with submitted form data'
  AFTER verification_requested_at;

-- ---------------------------------------------------------------------------
-- businesses: fisherman_code
-- ---------------------------------------------------------------------------
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS fisherman_code CHAR(6) NULL DEFAULT NULL UNIQUE
    COMMENT '6-digit unique code shown to fisherman';

UPDATE businesses
  SET fisherman_code = LPAD(FLOOR(100000 + RAND() * 899999), 6, '0')
  WHERE fisherman_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_fisherman_code ON businesses (fisherman_code);

-- ---------------------------------------------------------------------------
-- businesses: etimologiera_username (no IF NOT EXISTS in original — guarded here)
-- ---------------------------------------------------------------------------
SET @_col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'businesses' AND COLUMN_NAME = 'etimologiera_username');
SET @_sql = IF(@_col = 0,
  "ALTER TABLE businesses ADD COLUMN etimologiera_username VARCHAR(255) NULL COMMENT 'e-timologiera account username (email)'",
  'SELECT 1');
PREPARE _stmt FROM @_sql; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- ---------------------------------------------------------------------------
-- invoices: mydata_qr and etimologiera_uid columns + index
-- ---------------------------------------------------------------------------
SET @_col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'mydata_qr');
SET @_sql = IF(@_col = 0,
  "ALTER TABLE invoices ADD COLUMN mydata_qr TEXT NULL COMMENT 'QR code URL returned by e-timologiera / AADE'",
  'SELECT 1');
PREPARE _stmt FROM @_sql; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

SET @_col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'etimologiera_uid');
SET @_sql = IF(@_col = 0,
  "ALTER TABLE invoices ADD COLUMN etimologiera_uid VARCHAR(128) NULL COMMENT 'Unique invoice ID assigned by e-timologiera'",
  'SELECT 1');
PREPARE _stmt FROM @_sql; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

SET @_idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND INDEX_NAME = 'idx_invoices_etim_uid');
SET @_sql = IF(@_idx = 0,
  'CREATE INDEX idx_invoices_etim_uid ON invoices (etimologiera_uid)',
  'SELECT 1');
PREPARE _stmt FROM @_sql; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- ---------------------------------------------------------------------------
-- delivery_notes: client_ref column + unique index
-- ---------------------------------------------------------------------------
ALTER TABLE delivery_notes
  ADD COLUMN IF NOT EXISTS client_ref VARCHAR(100) NULL DEFAULT NULL;

SET @_idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'delivery_notes' AND INDEX_NAME = 'idx_dn_biz_client_ref');
SET @_sql = IF(@_idx = 0,
  'CREATE UNIQUE INDEX idx_dn_biz_client_ref ON delivery_notes (business_id, client_ref)',
  'SELECT 1');
PREPARE _stmt FROM @_sql; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- ---------------------------------------------------------------------------
-- business_settings: feature_weighing_slips and feature_ospa
-- ---------------------------------------------------------------------------
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS feature_weighing_slips TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feature_ospa           TINYINT NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- bug_reports table (idempotent)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bug_reports (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  reporter_id  CHAR(36)     NOT NULL COMMENT 'accountant user id',
  category     VARCHAR(50)  NOT NULL,
  description  TEXT         NOT NULL,
  steps        TEXT         NULL,
  severity     ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status       ENUM('open','in_progress','resolved','closed') NOT NULL DEFAULT 'open',
  admin_notes  TEXT         NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bug_reporter (reporter_id),
  KEY idx_bug_status   (status),
  KEY idx_bug_severity (severity),
  CONSTRAINT fk_bug_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- employee_privileges table (idempotent — live DB uses char(36), not INT)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_privileges (
  id          CHAR(36)  NOT NULL DEFAULT (UUID()),
  user_id     CHAR(36)  NOT NULL,
  business_id CHAR(36)  NULL,
  privileges  JSON      NULL,
  granted_by  CHAR(36)  NULL,
  granted_at  DATETIME  NULL,
  updated_at  DATETIME  DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_employee_user (user_id),
  KEY idx_ep_business (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- users: 'employee' role in enum (safe MODIFY — only changes enum list)
-- ---------------------------------------------------------------------------
SET @_col = (SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role');
SET @_sql = IF(@_col NOT LIKE '%employee%',
  "ALTER TABLE users MODIFY COLUMN role ENUM('super_admin','owner','accountant','captain','employee') NOT NULL DEFAULT 'employee'",
  'SELECT 1');
PREPARE _stmt FROM @_sql; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- ---------------------------------------------------------------------------
-- platform_settings: seed rows
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES
  ('maintenance_mode',         '0'),
  ('maintenance_message',      'Εκτελούνται εργασίες συντήρησης. Σύντομα θα είμαστε πάλι κοντά σας.'),
  ('web_base_url',             NULL),
  ('app_base_url',             NULL),
  ('admin_notification_email', 'admin@fishbill.gr');
