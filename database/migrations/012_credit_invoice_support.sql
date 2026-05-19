-- Migration 012: Credit/reversal invoice support
-- Run: mysql -u root fishbill_db < migrations/012_credit_invoice_support.sql

-- Add related_invoice_id to link credit invoices to their originals
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS related_invoice_id VARCHAR(36) NULL DEFAULT NULL
    COMMENT 'For credit invoices (type 1.3): references the original invoice being reversed';

-- Index for quick lookups of credit invoices by original
ALTER TABLE invoices
  ADD INDEX IF NOT EXISTS idx_related_invoice (related_invoice_id);
