-- Migration 006: Add auto_renew column to businesses table
-- Run this once on the production database

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS auto_renew TINYINT(1) DEFAULT 1 COMMENT '1 = auto-renew enabled, 0 = will cancel at period end';

-- Set default: all existing active subscriptions default to auto_renew = 1
UPDATE businesses SET auto_renew = 1 WHERE auto_renew IS NULL;
