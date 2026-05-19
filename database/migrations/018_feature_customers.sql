-- Migration 018 — Feature toggle: Customers tab
-- Run against fishbill_db

USE fishbill_db;

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS feature_customers TINYINT(1) NOT NULL DEFAULT 0
  COMMENT 'Ψαράς ενεργοποιεί/απενεργοποιεί την καρτέλα Πελατών';
