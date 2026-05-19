-- Migration: add feature_weighing_slips and feature_ospa to business_settings
-- Run once against the production database.

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS feature_weighing_slips TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feature_ospa           TINYINT NOT NULL DEFAULT 0;

-- Back-fill: Pro and Enterprise subscribers already paid for the full package,
-- so enable weighing slips for them automatically.
UPDATE business_settings bs
  JOIN businesses b ON b.id = bs.business_id
SET bs.feature_weighing_slips = 1
WHERE b.plan IN ('pro', 'enterprise')
  AND (b.subscription_active = 1 OR (b.trial_ends_at IS NOT NULL AND b.trial_ends_at > NOW()));
