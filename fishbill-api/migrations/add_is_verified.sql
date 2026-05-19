-- Migration: Add is_verified column to users table for accountant verification
-- Run this once on the production database

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_verified TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Accountant verification status. 0=pending, 1=verified by super_admin.'
  AFTER is_active;

-- Optionally auto-verify all existing super_admin and owner accounts
UPDATE users SET is_verified = 1 WHERE role IN ('super_admin', 'owner');
