-- ============================================================
-- Migration 004: IRIS Payments
-- IRIS = Greek instant payment system (DIAS)
-- ============================================================

-- Platform-level key/value settings (for super_admin use)
CREATE TABLE IF NOT EXISTS platform_settings (
  `key`       VARCHAR(100) PRIMARY KEY,
  `value`     TEXT,
  updated_at  DATETIME DEFAULT NOW() ON UPDATE NOW()
);

-- Default platform IRIS configuration (disabled until admin fills in real IBAN)
INSERT IGNORE INTO platform_settings (`key`, `value`) VALUES
  ('iris_enabled',      '0'),
  ('iris_iban',         ''),
  ('iris_beneficiary',  'FishBill OE'),
  ('iris_bank_name',    'Εθνική Τράπεζα'),
  ('iris_mobile',       ''),
  ('iris_bic',          'ETHNGRAA'),
  ('iris_instructions', 'Πραγματοποιήστε μεταφορά μέσω IRIS/τραπεζικής μεταφοράς και στείλτε αποδεικτικό στο support@fishbill.gr με θέμα: Συνδρομή [email σας].');

-- Business-level IRIS settings (add to existing business_settings table)
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS iris_enabled     TINYINT(1)   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iris_iban        VARCHAR(50)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS iris_beneficiary VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS iris_bank_name   VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS iris_mobile      VARCHAR(30)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS iris_bic         VARCHAR(20)  DEFAULT NULL;

-- IRIS payment requests table (tracks per-invoice payment requests)
CREATE TABLE IF NOT EXISTS iris_payments (
  id             CHAR(36)          PRIMARY KEY DEFAULT (UUID()),
  business_id    CHAR(36)          NOT NULL,
  invoice_id     CHAR(36)          DEFAULT NULL,
  amount         DECIMAL(10,2)     NOT NULL,
  description    VARCHAR(500)      DEFAULT NULL,
  status         ENUM('pending','completed','failed','cancelled') DEFAULT 'pending',
  payer_name     VARCHAR(255)      DEFAULT NULL,
  payer_mobile   VARCHAR(30)       DEFAULT NULL,
  reference_code VARCHAR(100)      DEFAULT NULL,
  notes          TEXT              DEFAULT NULL,
  completed_at   DATETIME          DEFAULT NULL,
  created_at     DATETIME          DEFAULT NOW(),
  updated_at     DATETIME          DEFAULT NOW() ON UPDATE NOW(),
  CONSTRAINT fk_iris_biz     FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_iris_invoice FOREIGN KEY (invoice_id)  REFERENCES invoices(id)   ON DELETE SET NULL
);
