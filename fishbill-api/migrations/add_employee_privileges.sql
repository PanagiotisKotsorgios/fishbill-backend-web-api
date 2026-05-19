-- ============================================================
-- Migration: Employee Privileges System
-- Run in phpMyAdmin or MySQL CLI after selecting fishbill_db
-- ============================================================
USE fishbill_db;

-- Step 1: Ensure 'employee' role exists in users table enum
-- Check first: SELECT COLUMN_TYPE FROM information_schema.COLUMNS
--              WHERE TABLE_SCHEMA='fishbill_db' AND TABLE_NAME='users' AND COLUMN_NAME='role';
-- If 'employee' is missing from the enum, run the ALTER below:
ALTER TABLE users
  MODIFY COLUMN role ENUM('super_admin','owner','accountant','captain','employee')
  NOT NULL DEFAULT 'employee';

-- Step 2: Create employee_privileges table
CREATE TABLE IF NOT EXISTS employee_privileges (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     CHAR(36) NOT NULL UNIQUE,
  privileges  JSON NOT NULL DEFAULT (JSON_ARRAY()),
  granted_by  CHAR(36) NULL,
  granted_at  DATETIME DEFAULT NOW(),
  updated_at  DATETIME DEFAULT NOW() ON UPDATE NOW(),
  CONSTRAINT fk_ep_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ep_grantor
    FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-employee access privilege list, managed by super_admin with OTP verification';

-- Verify
SELECT 'employee_privileges table created OK' AS status;
