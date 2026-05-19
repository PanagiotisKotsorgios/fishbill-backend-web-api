-- Migration 004: Add avatar_url to users table
-- Run this against the fishbill database

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500) DEFAULT NULL AFTER email;
