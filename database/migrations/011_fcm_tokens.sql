-- Migration 011: FCM tokens for push notifications
-- Run: mysql -u root fishbill_db < migrations/011_fcm_tokens.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS fcm_token VARCHAR(500) NULL DEFAULT NULL
    COMMENT 'Firebase Cloud Messaging token for push notifications',
  ADD COLUMN IF NOT EXISTS fcm_updated_at TIMESTAMP NULL DEFAULT NULL
    COMMENT 'When the FCM token was last updated';
