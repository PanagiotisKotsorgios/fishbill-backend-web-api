-- FishBill Migration 003 — Accountant Portal
-- Creates accountant_clients linking table
-- Run against fishbill_db ONCE after migrations 001 & 002

USE fishbill_db;

-- ── accountant_clients: links accountant users to businesses they manage ──────
CREATE TABLE IF NOT EXISTS accountant_clients (
    id            CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    accountant_id CHAR(36)  NOT NULL COMMENT 'users.id where role=accountant',
    business_id   CHAR(36)  NOT NULL,
    notes         TEXT      NULL     COMMENT 'Internal notes by accountant',
    added_at      DATETIME  DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_ac (accountant_id, business_id),
    FOREIGN KEY (accountant_id) REFERENCES users(id)      ON DELETE CASCADE,
    FOREIGN KEY (business_id)   REFERENCES businesses(id) ON DELETE CASCADE,
    INDEX idx_accountant (accountant_id),
    INDEX idx_business   (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 003 applied successfully.' AS result;
