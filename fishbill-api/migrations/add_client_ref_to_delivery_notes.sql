-- Run this once via phpMyAdmin or MySQL client to enable delivery-note idempotency.
-- Safe to re-run: IF NOT EXISTS prevents duplicate column errors.

ALTER TABLE delivery_notes
  ADD COLUMN IF NOT EXISTS client_ref VARCHAR(100) NULL DEFAULT NULL;

-- Unique index per business so duplicate offline retries are detected instantly.
-- Allow NULL so notes created without a client_ref (web/admin) are not affected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dn_biz_client_ref
  ON delivery_notes (business_id, client_ref);
