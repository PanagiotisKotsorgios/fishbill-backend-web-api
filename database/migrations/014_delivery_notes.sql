-- ============================================================
-- Migration 014: Delivery Notes (Δελτία Αποστολής)
-- ============================================================
-- Adds the delivery_notes and delivery_note_lines tables.
-- A Δελτίο Αποστολής (document type 9.1 in myDATA) is required
-- for fishermen transporting/delivering fish in Greece from 2026.
-- Run this in phpMyAdmin on fishbill_db.
-- ============================================================

CREATE TABLE IF NOT EXISTS delivery_notes (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  business_id      CHAR(36)      NOT NULL,
  series           VARCHAR(10)   NOT NULL DEFAULT 'ΔΑ',
  number           INT           NOT NULL DEFAULT 0,
  issue_date       DATE          NOT NULL,

  -- Recipient (Παραλήπτης)
  recipient_name   VARCHAR(255)  NOT NULL,
  recipient_afm    VARCHAR(20)   DEFAULT NULL,
  recipient_doy    VARCHAR(100)  DEFAULT NULL,
  recipient_address VARCHAR(255) DEFAULT NULL,
  recipient_city   VARCHAR(100)  DEFAULT NULL,
  recipient_postal VARCHAR(20)   DEFAULT NULL,
  recipient_phone  VARCHAR(30)   DEFAULT NULL,

  -- Dispatch/Delivery info
  dispatch_location  VARCHAR(255) DEFAULT NULL,
  delivery_location  VARCHAR(255) DEFAULT NULL,
  vehicle_plate      VARCHAR(30)  DEFAULT NULL,

  notes            TEXT          DEFAULT NULL,

  -- Status: draft | issued | transmitted | failed | cancelled
  status           VARCHAR(30)   NOT NULL DEFAULT 'draft',
  mydata_mark      VARCHAR(100)  DEFAULT NULL,
  mydata_uid       VARCHAR(100)  DEFAULT NULL,
  mydata_response  TEXT          DEFAULT NULL,

  created_by       CHAR(36)      DEFAULT NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_dn_business (business_id),
  INDEX idx_dn_status   (status),
  INDEX idx_dn_date     (issue_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Line items ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_note_lines (
  id                   CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  delivery_note_id     CHAR(36)       NOT NULL,
  sort_order           TINYINT        NOT NULL DEFAULT 0,
  description          VARCHAR(500)   NOT NULL,
  quantity             DECIMAL(12,4)  NOT NULL DEFAULT 0,
  unit                 VARCHAR(20)    NOT NULL DEFAULT 'kg',
  unit_price           DECIMAL(12,4)  NOT NULL DEFAULT 0,
  vat_rate             DECIMAL(5,2)   NOT NULL DEFAULT 0,
  net_amount           DECIMAL(12,4)  NOT NULL DEFAULT 0,

  INDEX idx_dnl_note (delivery_note_id),
  CONSTRAINT fk_dnl_note FOREIGN KEY (delivery_note_id)
    REFERENCES delivery_notes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
