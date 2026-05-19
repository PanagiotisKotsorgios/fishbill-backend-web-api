-- ============================================================
-- FishBill – Pending Migrations (run this once to bring DB up-to-date)
-- Date: 2026-04-08
-- ============================================================

-- ─── 1. is_verified column on users ──────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_verified TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Accountant verification status. 0=pending, 1=verified by super_admin.'
  AFTER is_active;

-- Auto-verify existing super_admin and owner accounts
UPDATE users SET is_verified = 1 WHERE role IN ('super_admin', 'owner');

-- ─── 2. Accountant notification columns on users ──────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notif_new_invoice  TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Email on new invoice from client',
  ADD COLUMN IF NOT EXISTS notif_mydata_fail  TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Email on myDATA transmission failure',
  ADD COLUMN IF NOT EXISTS notif_client_new   TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Email when new client links accountant',
  ADD COLUMN IF NOT EXISTS notif_subscription TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Email for subscription updates';

-- ─── 3. Fisherman 6-digit connection code on businesses ──────
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS fisherman_code CHAR(6) NULL DEFAULT NULL UNIQUE
    COMMENT '6-digit unique code shown to fisherman; used by accountant to link client';

-- Generate codes for businesses that do not yet have one
UPDATE businesses
SET fisherman_code = LPAD(FLOOR(100000 + RAND() * 899999), 6, '0')
WHERE fisherman_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_fisherman_code ON businesses(fisherman_code);

-- ─── 4. Bug reports table ─────────────────────────────────────
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
  CONSTRAINT fk_bug_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
