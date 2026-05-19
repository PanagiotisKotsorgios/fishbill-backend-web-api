-- Migration: 010_invoice_cancel_otp.sql
-- Adds support for invoice cancellation OTP flow.
-- OTP tokens are stored in platform_settings with key pattern: cancel_otp_{invoice_id}
-- No schema change is required since platform_settings already exists.
-- This migration simply documents the feature and ensures the index is present.

-- Ensure platform_settings has an index on setting_key for fast OTP lookups
-- (safe to run if index already exists due to IF NOT EXISTS guard)
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Index for fast OTP key lookups (cancel_otp_% prefix scans)
CREATE INDEX IF NOT EXISTS idx_platform_settings_key
  ON platform_settings (setting_key);