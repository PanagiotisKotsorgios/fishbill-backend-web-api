-- Migration 009: Fisherman 6-digit code & bug reports
-- Date: 2026-04-07
-- Description:
--   1. Add unique 6-digit fisherman_code to businesses (used by accountant to link client)
--   2. Create bug_reports table for accountant feedback to admin

-- ─── 1. Add fisherman_code to businesses ─────────────────────────────────────

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS fisherman_code CHAR(6) NULL DEFAULT NULL UNIQUE
    COMMENT '6-digit unique code shown to fisherman, used by accountant to link';

-- Generate codes for existing businesses that don't have one
-- (run once; new businesses get codes via app/API trigger)
UPDATE businesses
SET fisherman_code = LPAD(FLOOR(100000 + RAND() * 899999), 6, '0')
WHERE fisherman_code IS NULL;

-- Ensure uniqueness (in case of collision, re-run until clean)
-- Application layer should also enforce uniqueness on insert.

CREATE INDEX IF NOT EXISTS idx_businesses_fisherman_code ON businesses(fisherman_code);


-- ─── 2. Accountant profile settings (notifications) ──────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notif_new_invoice  TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Email on new invoice from client',
  ADD COLUMN IF NOT EXISTS notif_mydata_fail  TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Email on myDATA transmission failure',
  ADD COLUMN IF NOT EXISTS notif_client_new   TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'Email when new client links accountant',
  ADD COLUMN IF NOT EXISTS notif_subscription TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Email for subscription updates';


-- ─── 3. Bug reports table ────────────────────────────────────────────────────

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
