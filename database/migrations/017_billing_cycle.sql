-- Migration 017: Billing cycle support (monthly / semi_annual / annual)
-- Run once against the fishbill database.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS billing_cycle ENUM('monthly','semi_annual','annual') NOT NULL DEFAULT 'monthly'
    COMMENT 'Billing cadence chosen by the business when requesting a plan';

-- Update status API response helper (no schema change needed — billing_cycle is returned as-is)
-- Index for admin filtering by billing cycle
CREATE INDEX IF NOT EXISTS idx_businesses_billing_cycle ON businesses (billing_cycle);
