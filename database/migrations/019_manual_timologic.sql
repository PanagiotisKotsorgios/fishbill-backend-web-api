-- FishBill Migration 019 — Manual Epsilon Smart provider as default
-- Run against fishbill_db in phpMyAdmin
-- Safe to re-run

USE fishbill_db;

-- Set manual_epsilonsmart as the active invoice provider
UPDATE platform_settings
SET setting_value = 'manual_epsilonsmart', updated_at = NOW()
WHERE setting_key = 'provider_name';

-- Add provider note
INSERT INTO platform_settings (setting_key, setting_value)
VALUES ('provider_notes', 'Manual Epsilon Smart (Entry Edition) — admin processes invoices at app.epsilonsmart.gr and enters MARK manually.')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW();

SELECT 'Migration 019 (manual_epsilonsmart) applied!' AS result;
