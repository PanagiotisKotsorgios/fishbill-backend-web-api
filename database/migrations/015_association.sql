-- ============================================================
-- Migration 015: Business Associations (Σύλλογοι/Ενώσεις)
-- ============================================================
-- Adds a business_associations lookup table and an association_id
-- FK on the businesses table so the admin can group fishermen by
-- their σύλλογος / ένωση αλιέων.
-- ============================================================

CREATE TABLE IF NOT EXISTS business_associations (
  id          CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  name        VARCHAR(200)  NOT NULL,
  description TEXT          DEFAULT NULL,
  region      VARCHAR(100)  DEFAULT NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assoc_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add association_id to businesses (nullable — fisherman may not belong to one yet)
ALTER TABLE businesses ADD COLUMN association_id CHAR(36) DEFAULT NULL AFTER afm;
ALTER TABLE businesses ADD COLUMN admin_notes TEXT DEFAULT NULL AFTER association_id;

-- FK — if association is deleted, set to NULL (keep the business)
ALTER TABLE businesses
  ADD CONSTRAINT fk_biz_association
    FOREIGN KEY (association_id) REFERENCES business_associations(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
