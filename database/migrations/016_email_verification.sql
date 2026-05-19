-- Migration 016: Email verification for user accounts
-- Run once on the database before deploying new auth.routes.js

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified       TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_verify_token   VARCHAR(36)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email_verify_expires DATETIME     DEFAULT NULL;

-- Mark all existing users as verified so existing accounts still work
UPDATE users SET email_verified = 1 WHERE email_verified = 0;
