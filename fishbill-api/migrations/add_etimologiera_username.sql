-- Migration: Add etimologiera_username to businesses table
-- Already applied 2026-04-20 via CLI.
USE fishbill_db;

ALTER TABLE businesses
  ADD COLUMN etimologiera_username VARCHAR(255) NULL
    COMMENT 'e-timologiera account username (email) — per business';

SELECT 'etimologiera_username migration OK' AS status;
