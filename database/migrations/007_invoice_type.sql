-- Migration 007: Add invoice_type to invoices table
-- myDATA invoice types: 1.1 = Τιμολόγιο Πώλησης (most common for fishermen)
-- Also adds income_classification_category for line items

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_type VARCHAR(10) DEFAULT '1.1'
    COMMENT '1.1=ΤΠ, 1.2=ΤΠ-ΔΑ, 2.1=ΤΠΥ, 5.1=Πιστ.Τιμ., 11.1=ΑΛΠ, 11.2=ΑΛΠ-ΔΑ';

ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS income_classification_category VARCHAR(30) DEFAULT 'category1_1'
    COMMENT 'myDATA income category: category1_1=αγαθά, category1_3=παροχή υπηρεσιών, κλπ.',
  ADD COLUMN IF NOT EXISTS income_classification_type VARCHAR(30) DEFAULT 'E3_561_001'
    COMMENT 'myDATA type: E3_561_001=χονδρική, E3_561_002=λιανική, E3_561_007=λοιπά';

-- Update existing invoices to default type
UPDATE invoices SET invoice_type = '1.1' WHERE invoice_type IS NULL;
