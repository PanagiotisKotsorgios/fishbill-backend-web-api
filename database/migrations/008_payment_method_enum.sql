-- Migration 008: Expand payment_method ENUM to include all values used by the API
-- Adds: bank_transfer, credit_card, iris (were accepted by API but not in DB schema)

ALTER TABLE invoices
  MODIFY COLUMN payment_method
    ENUM('cash','bank','bank_transfer','check','credit','credit_card','card','iris','other')
    DEFAULT 'cash';
