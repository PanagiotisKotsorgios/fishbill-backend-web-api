-- =============================================================================
-- FishBill Database Schema  (auto-generated 2026-05-24 from live DB)
-- MySQL 8.0+
-- Tables are ordered so that FK dependencies are created first.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS fishbill_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE fishbill_db;

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- business_associations  (no FK deps)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `business_associations` (
  `id`          char(36)     COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `name`        varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text         COLLATE utf8mb4_unicode_ci,
  `region`      varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at`  datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_assoc_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- businesses  (FK → business_associations)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `businesses` (
  `id`                           char(36)      COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `afm`                          varchar(9)    COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Tax ID',
  `association_id`               char(36)      COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `admin_notes`                  text          COLLATE utf8mb4_unicode_ci,
  `name`                         varchar(255)  COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Company name',
  `trade_name`                   varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Trade name',
  `doy`                          varchar(100)  COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Tax office',
  `address`                      text          COLLATE utf8mb4_unicode_ci,
  `city`                         varchar(100)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `postal_code`                  varchar(5)    COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone`                        varchar(20)   COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email`                        varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `activity_code`                varchar(10)   COLLATE utf8mb4_unicode_ci DEFAULT '03.11',
  `vat_regime`                   enum('normal','small_business','exempt') COLLATE utf8mb4_unicode_ci DEFAULT 'normal',
  `invoice_series`               varchar(10)   COLLATE utf8mb4_unicode_ci DEFAULT 'A',
  `invoice_counter`              int           DEFAULT '0',
  `receipt_series`               varchar(10)   COLLATE utf8mb4_unicode_ci DEFAULT 'B',
  `receipt_counter`              int           DEFAULT '0',
  `mydata_user_id`               varchar(100)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mydata_subscription_key`      text          COLLATE utf8mb4_unicode_ci,
  `provider_name`                varchar(50)   COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `provider_api_key`             text          COLLATE utf8mb4_unicode_ci,
  `provider_api_url`             varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `provider_username`            varchar(100)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `provider_password`            text          COLLATE utf8mb4_unicode_ci,
  `plan`                         enum('trial','basic','pro','enterprise') COLLATE utf8mb4_unicode_ci DEFAULT 'trial',
  `trial_ends_at`                datetime      DEFAULT NULL,
  `subscription_active`          tinyint(1)    DEFAULT '0',
  `is_first_subscription`        tinyint(1)    NOT NULL DEFAULT '1',
  `subscription_ends_at`         datetime      DEFAULT NULL,
  `stripe_customer_id`           varchar(100)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active`                    tinyint(1)    DEFAULT '1',
  `is_suspended`                 tinyint(1)    DEFAULT '0',
  `suspend_reason`               varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accountant_name`              varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accountant_email`             varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accountant_phone`             varchar(20)   COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mydata_provider`              varchar(30)   COLLATE utf8mb4_unicode_ci DEFAULT 'direct' COMMENT 'direct | softone | epsilonnet | unidoc | entersoft | singular | megasoft',
  `softone_api_key`              varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `softone_api_url`              varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT 'https://api.softone.gr/api/mydata',
  `softone_username`             varchar(100)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `softone_password`             varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `softone_company_id`           varchar(50)   COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `epsilonnet_api_key`           varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `epsilonnet_api_url`           varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT 'https://mydata.epsilonnet.gr/api',
  `epsilonnet_username`          varchar(100)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `epsilonnet_password`          varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `unidoc_api_key`               varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `unidoc_api_url`               varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT 'https://api.unidoc.gr/v1',
  `unidoc_username`              varchar(100)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `unidoc_password`              varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gsis_username`                varchar(100)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gsis_password`                text          COLLATE utf8mb4_unicode_ci,
  `auto_renew`                   tinyint(1)    DEFAULT '1' COMMENT '1 = auto-renew enabled',
  `fisherman_code`               char(6)       COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '6-digit unique code',
  `etimologiera_api_key`         varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `etimologiera_subscription_id` varchar(100)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `etimologiera_api_url`         varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT 'https://app.etimologiera.gr/api/v1',
  `allowed_invoice_types`        json          DEFAULT NULL COMMENT 'Max 5 allowed myDATA invoice types for fisherman',
  `billing_cycle`                varchar(20)   COLLATE utf8mb4_unicode_ci DEFAULT 'monthly',
  `fishing_license`              varchar(60)   COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `etimologiera_username`        varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'e-timologiera account username (email)',
  `outstanding_balance`          decimal(10,2) NOT NULL DEFAULT '0.00',
  `plan_price_override`          decimal(8,2)  DEFAULT NULL COMMENT 'Custom monthly price override',
  `contact_phone`                varchar(30)   COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Primary contact phone for payment calls',
  `is_parametrised`              tinyint(1)    NOT NULL DEFAULT '0',
  `extra_dn_credits`             int           NOT NULL DEFAULT '0',
  `extra_invoice_credits`        int           NOT NULL DEFAULT '0',
  `billing_cycle_started_at`     date          DEFAULT NULL,
  `created_at`                   datetime      DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                   datetime      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `afm` (`afm`),
  UNIQUE KEY `fisherman_code` (`fisherman_code`),
  KEY `idx_afm` (`afm`),
  KEY `idx_plan` (`plan`),
  KEY `idx_active` (`is_active`),
  KEY `idx_businesses_fisherman_code` (`fisherman_code`),
  KEY `fk_biz_association` (`association_id`),
  CONSTRAINT `fk_biz_association` FOREIGN KEY (`association_id`) REFERENCES `business_associations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- users  (FK → businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`                       char(36)    COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id`              char(36)    COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `full_name`                varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email`                    varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `avatar_url`               varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone`                    varchar(20)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone_verified`           tinyint(1)   DEFAULT '0',
  `password_hash`            varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role`                     enum('super_admin','owner','accountant','captain','employee') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'employee',
  `can_create_invoice`       tinyint(1)   DEFAULT '1',
  `can_cancel_invoice`       tinyint(1)   DEFAULT '0',
  `can_view_all`             tinyint(1)   DEFAULT '0',
  `can_export`               tinyint(1)   DEFAULT '0',
  `can_manage_users`         tinyint(1)   DEFAULT '0',
  `can_view_logs`            tinyint(1)   DEFAULT '0',
  `last_login_at`            datetime     DEFAULT NULL,
  `last_login_ip`            varchar(45)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active`                tinyint(1)   DEFAULT '1',
  `is_verified`              tinyint(1)   NOT NULL DEFAULT '0' COMMENT 'Accountant verification status',
  `email_verified`           tinyint(1)   DEFAULT '0',
  `reset_token`              varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reset_token_expires`      datetime     DEFAULT NULL,
  `invite_token`             varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invite_expires`           datetime     DEFAULT NULL,
  `notif_new_invoice`        tinyint(1)   NOT NULL DEFAULT '1' COMMENT 'Email on new invoice from client',
  `notif_mydata_fail`        tinyint(1)   NOT NULL DEFAULT '1' COMMENT 'Email on myDATA transmission failure',
  `notif_client_new`         tinyint(1)   NOT NULL DEFAULT '1' COMMENT 'Email when new client links accountant',
  `notif_subscription`       tinyint(1)   NOT NULL DEFAULT '0' COMMENT 'Email for subscription updates',
  `fcm_token`                text         COLLATE utf8mb4_unicode_ci COMMENT 'FCM push token',
  `fcm_updated_at`           datetime     DEFAULT NULL,
  `verification_requested_at` datetime    DEFAULT NULL,
  `verification_data`        json         DEFAULT NULL,
  `email_verify_token`       varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email_verify_expires`     datetime     DEFAULT NULL,
  `last_seen_at`             datetime     DEFAULT NULL,
  `created_at`               datetime     DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_business` (`business_id`),
  KEY `idx_email` (`email`),
  KEY `idx_role` (`role`),
  KEY `idx_phone` (`phone`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- customers  (FK → businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `customers` (
  `id`                     char(36)      COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id`            char(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  `afm`                    varchar(9)    COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Tax ID (for B2B)',
  `doy`                    varchar(100)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name`                   varchar(255)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `trade_name`             varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address`                text          COLLATE utf8mb4_unicode_ci,
  `city`                   varchar(100)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `postal_code`            varchar(5)    COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `country`                char(2)       COLLATE utf8mb4_unicode_ci DEFAULT 'GR',
  `phone`                  varchar(20)   COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email`                  varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contact_person`         varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes`                  text          COLLATE utf8mb4_unicode_ci,
  `payment_terms`          int           DEFAULT '30',
  `default_payment_method` enum('cash','bank','check','credit') COLLATE utf8mb4_unicode_ci DEFAULT 'cash',
  `is_favorite`            tinyint(1)    DEFAULT '0',
  `is_active`              tinyint(1)    DEFAULT '1',
  `total_invoices`         int           DEFAULT '0',
  `total_amount`           decimal(12,2) DEFAULT '0.00',
  `last_invoice_at`        datetime      DEFAULT NULL,
  `created_at`             datetime      DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             datetime      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_business` (`business_id`),
  KEY `idx_afm` (`afm`),
  KEY `idx_name` (`name`),
  KEY `idx_favorite` (`is_favorite`),
  FULLTEXT KEY `ft_customers` (`name`,`afm`,`email`,`phone`,`city`),
  CONSTRAINT `customers_ibfk_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- products  (FK → businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `products` (
  `id`              char(36)      COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id`     char(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  `name`            varchar(255)  COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'e.g. Sea Bream, Bass',
  `code`            varchar(50)   COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description`     text          COLLATE utf8mb4_unicode_ci,
  `unit`            varchar(20)   COLLATE utf8mb4_unicode_ci DEFAULT 'KG',
  `default_price`   decimal(10,4) DEFAULT NULL,
  `vat_rate`        tinyint       DEFAULT '13',
  `income_category` varchar(20)   COLLATE utf8mb4_unicode_ci DEFAULT 'E3_561_001',
  `income_type`     varchar(10)   COLLATE utf8mb4_unicode_ci DEFAULT '1.1',
  `is_favorite`     tinyint(1)    DEFAULT '0',
  `is_active`       tinyint(1)    DEFAULT '1',
  `sort_order`      int           DEFAULT '0',
  `created_at`      datetime      DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      datetime      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_business` (`business_id`),
  KEY `idx_name` (`name`),
  FULLTEXT KEY `ft_products` (`name`,`code`,`description`),
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- invoice_series  (FK → businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `invoice_series` (
  `id`             char(36)    COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id`    char(36)    COLLATE utf8mb4_unicode_ci NOT NULL,
  `series`         varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description`    varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invoice_type`   varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT '1.1',
  `current_number` int         DEFAULT '0',
  `is_default`     tinyint(1)  DEFAULT '0',
  `is_active`      tinyint(1)  DEFAULT '1',
  `created_at`     datetime    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_series` (`business_id`,`series`),
  CONSTRAINT `invoice_series_ibfk_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- invoices  (FK → businesses, customers, users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `invoices` (
  `id`                  char(36)      COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id`         char(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_id`         char(36)      COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by`          char(36)      COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `series`              varchar(10)   COLLATE utf8mb4_unicode_ci NOT NULL,
  `number`              int           NOT NULL,
  `full_number`         varchar(50)   COLLATE utf8mb4_unicode_ci NOT NULL,
  `invoice_type`        varchar(10)   COLLATE utf8mb4_unicode_ci DEFAULT '1.1',
  `issue_date`          date          NOT NULL DEFAULT (curdate()),
  `issue_time`          time          NOT NULL DEFAULT (curtime()),
  `due_date`            date          DEFAULT NULL,
  `payment_method`      enum('cash','bank','bank_transfer','check','credit','credit_card','card','iris','other') COLLATE utf8mb4_unicode_ci DEFAULT 'cash',
  `net_value`           decimal(12,2) DEFAULT '0.00',
  `vat_amount`          decimal(12,2) DEFAULT '0.00',
  `total_value`         decimal(12,2) DEFAULT '0.00',
  `discount_amount`     decimal(12,2) DEFAULT '0.00',
  `status`              enum('draft','issued','pending_retry','transmitted','failed','cancelled') COLLATE utf8mb4_unicode_ci DEFAULT 'draft',
  `mydata_mark`         varchar(50)   COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mydata_uid`          varchar(100)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mydata_cancel_mark`  varchar(50)   COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mydata_qr`           text          COLLATE utf8mb4_unicode_ci COMMENT 'QR code URL returned by e-timologiera / AADE',
  `etimologiera_uid`    varchar(128)  COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Unique invoice ID assigned by e-timologiera',
  `provider_name`       varchar(50)   COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `provider_reference`  varchar(100)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `retry_count`         int           DEFAULT '0',
  `next_retry_at`       datetime      DEFAULT NULL,
  `last_error`          text          COLLATE utf8mb4_unicode_ci,
  `notes`               text          COLLATE utf8mb4_unicode_ci,
  `pdf_path`            varchar(500)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pdf_generated_at`    datetime      DEFAULT NULL,
  `transmitted_at`      datetime      DEFAULT NULL,
  `cancelled_at`        datetime      DEFAULT NULL,
  `related_invoice_id`  char(36)      COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at`          datetime      DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          datetime      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_invoice` (`business_id`,`series`,`number`),
  KEY `idx_business` (`business_id`),
  KEY `idx_status` (`status`),
  KEY `idx_date` (`issue_date`),
  KEY `idx_mark` (`mydata_mark`),
  KEY `idx_customer` (`customer_id`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_invoices_etim_uid` (`etimologiera_uid`),
  FULLTEXT KEY `ft_invoices` (`full_number`),
  CONSTRAINT `invoices_ibfk_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`),
  CONSTRAINT `invoices_ibfk_2` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `invoices_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- invoice_lines  (FK → invoices, products)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `invoice_lines` (
  `id`                              char(36)      COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `invoice_id`                      char(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  `product_id`                      char(36)      COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `line_number`                     int           NOT NULL DEFAULT '1',
  `description`                     varchar(500)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `unit`                            varchar(20)   COLLATE utf8mb4_unicode_ci DEFAULT 'KG',
  `quantity`                        decimal(10,3) NOT NULL,
  `unit_price`                      decimal(10,4) NOT NULL,
  `discount_pct`                    decimal(5,2)  DEFAULT '0.00',
  `discount_amt`                    decimal(10,2) DEFAULT '0.00',
  `net_value`                       decimal(12,2) NOT NULL,
  `vat_rate`                        tinyint       NOT NULL DEFAULT '13',
  `vat_amount`                      decimal(12,2) NOT NULL,
  `total_value`                     decimal(12,2) NOT NULL,
  `income_category`                 varchar(20)   COLLATE utf8mb4_unicode_ci DEFAULT 'E3_561_001',
  `income_type`                     varchar(10)   COLLATE utf8mb4_unicode_ci DEFAULT '1.1',
  `income_classification_category`  varchar(30)   COLLATE utf8mb4_unicode_ci DEFAULT 'category1_1',
  `income_classification_type`      varchar(30)   COLLATE utf8mb4_unicode_ci DEFAULT 'E3_561_001',
  PRIMARY KEY (`id`),
  KEY `product_id` (`product_id`),
  KEY `idx_invoice` (`invoice_id`),
  CONSTRAINT `invoice_lines_ibfk_1` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE CASCADE,
  CONSTRAINT `invoice_lines_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- transmission_logs  (FK → invoices)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `transmission_logs` (
  `id`              char(36)     COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `invoice_id`      char(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  `provider`        varchar(50)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `attempt_number`  int          DEFAULT '1',
  `request_url`     varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `request_payload` longtext     COLLATE utf8mb4_unicode_ci,
  `http_status`     smallint     DEFAULT NULL,
  `response_body`   longtext     COLLATE utf8mb4_unicode_ci,
  `success`         tinyint(1)   DEFAULT '0',
  `mydata_mark`     varchar(50)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error_message`   text         COLLATE utf8mb4_unicode_ci,
  `duration_ms`     int          DEFAULT NULL,
  `attempted_at`    datetime     DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_invoice` (`invoice_id`),
  KEY `idx_success` (`success`),
  KEY `idx_date` (`attempted_at`),
  CONSTRAINT `transmission_logs_ibfk_1` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- audit_logs  (no FK constraints — keeps data even if user/business deleted)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id`          bigint       NOT NULL AUTO_INCREMENT,
  `user_id`     char(36)     COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `business_id` char(36)     COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action`      varchar(50)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(50)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `entity_id`   char(36)     COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text         COLLATE utf8mb4_unicode_ci,
  `old_values`  json         DEFAULT NULL,
  `new_values`  json         DEFAULT NULL,
  `ip_address`  varchar(45)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent`  varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at`  datetime     DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_business` (`business_id`),
  KEY `idx_action` (`action`),
  KEY `idx_entity` (`entity_type`,`entity_id`),
  KEY `idx_date` (`created_at`),
  FULLTEXT KEY `ft_audit_logs` (`action`,`description`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- backup_logs  (FK → users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `backup_logs` (
  `id`           int          NOT NULL AUTO_INCREMENT,
  `initiated_by` char(36)     COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `filename`     varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `size_bytes`   bigint       DEFAULT NULL,
  `file_path`    varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_size`    bigint       DEFAULT NULL,
  `type`         enum('auto','manual') COLLATE utf8mb4_unicode_ci DEFAULT 'auto',
  `status`       enum('running','success','failed') COLLATE utf8mb4_unicode_ci DEFAULT 'running',
  `error_msg`    text         COLLATE utf8mb4_unicode_ci,
  `error_message` text        COLLATE utf8mb4_unicode_ci,
  `started_at`   datetime     DEFAULT CURRENT_TIMESTAMP,
  `finished_at`  datetime     DEFAULT NULL,
  `completed_at` datetime     DEFAULT NULL,
  `updated_at`   datetime     DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_backup_initiated_by` (`initiated_by`),
  CONSTRAINT `fk_backup_initiated_by` FOREIGN KEY (`initiated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- subscriptions  (FK → businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id`                     char(36)      COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id`            char(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan`                   enum('basic','pro','enterprise') COLLATE utf8mb4_unicode_ci DEFAULT 'basic',
  `price_eur`              decimal(8,2)  DEFAULT '10.00',
  `billing_cycle`          enum('monthly','annual') COLLATE utf8mb4_unicode_ci DEFAULT 'monthly',
  `stripe_sub_id`          varchar(100)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stripe_payment_method`  varchar(100)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status`                 enum('active','past_due','cancelled','trial') COLLATE utf8mb4_unicode_ci DEFAULT 'trial',
  `trial_ends_at`          datetime      DEFAULT NULL,
  `current_period_start`   datetime      DEFAULT NULL,
  `current_period_end`     datetime      DEFAULT NULL,
  `cancelled_at`           datetime      DEFAULT NULL,
  `created_at`             datetime      DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             datetime      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `business_id` (`business_id`),
  CONSTRAINT `subscriptions_ibfk_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- notifications  (FK → users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `notifications` (
  `id`         char(36)     COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `user_id`    char(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  `type`       varchar(50)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `title`      varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message`    text         COLLATE utf8mb4_unicode_ci,
  `is_read`    tinyint(1)   DEFAULT '0',
  `action_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime     DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_unread` (`user_id`,`is_read`),
  CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- accountant_clients  (FK → users, businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `accountant_clients` (
  `id`            char(36)  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `accountant_id` char(36)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `business_id`   char(36)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `notes`         text      COLLATE utf8mb4_unicode_ci,
  `added_at`      datetime  DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_ac` (`accountant_id`,`business_id`),
  KEY `idx_accountant` (`accountant_id`),
  KEY `idx_business` (`business_id`),
  CONSTRAINT `accountant_clients_ibfk_1` FOREIGN KEY (`accountant_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `accountant_clients_ibfk_2` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- bug_reports  (FK → users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bug_reports` (
  `id`          char(36)  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `reporter_id` char(36)  COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'accountant user id',
  `category`    varchar(50)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text         COLLATE utf8mb4_unicode_ci NOT NULL,
  `steps`       text         COLLATE utf8mb4_unicode_ci,
  `severity`    enum('low','medium','high','critical') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'medium',
  `status`      enum('open','in_progress','resolved','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `admin_notes` text         COLLATE utf8mb4_unicode_ci,
  `created_at`  datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bug_reporter` (`reporter_id`),
  KEY `idx_bug_status` (`status`),
  KEY `idx_bug_severity` (`severity`),
  CONSTRAINT `fk_bug_reporter` FOREIGN KEY (`reporter_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- business_credentials  (FK → businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `business_credentials` (
  `business_id`          char(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  `ospa_username`        varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ospa_password`        varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `timologio_username`   varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `timologio_password`   varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `timologio_afm`        varchar(15)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `epsilon_username`     varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `epsilon_password`     varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `extra_notes`          text         COLLATE utf8mb4_unicode_ci,
  `updated_at`           datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`business_id`),
  CONSTRAINT `fk_biz_creds` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- business_payments  (FK → businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `business_payments` (
  `id`              char(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  `business_id`     char(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount`          decimal(10,2) NOT NULL,
  `expected_amount` decimal(10,2) DEFAULT NULL,
  `description`     varchar(500)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `payment_type`    enum('subscription','addon','manual','bank','iris','cash','other') COLLATE utf8mb4_unicode_ci DEFAULT 'manual',
  `billing_period`  varchar(10)   COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'YYYY-MM',
  `status`          enum('pending','paid','failed','refunded','partial','waived') COLLATE utf8mb4_unicode_ci DEFAULT 'paid',
  `notes`           text          COLLATE utf8mb4_unicode_ci,
  `recorded_by`     char(36)      COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at`      datetime      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      datetime      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bpay_biz` (`business_id`),
  CONSTRAINT `fk_bpay_biz` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- business_settings  (FK → businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `business_settings` (
  `id`                   char(36)     COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id`          char(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  `smtp_host`            varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `smtp_port`            smallint     DEFAULT '587',
  `smtp_user`            varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `smtp_pass`            text         COLLATE utf8mb4_unicode_ci,
  `smtp_from_name`       varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `smtp_from_email`      varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `smtp_secure`          tinyint(1)   DEFAULT '0',
  `email_enabled`        tinyint(1)   DEFAULT '0',
  `email_provider`       varchar(30)  COLLATE utf8mb4_unicode_ci DEFAULT 'smtp' COMMENT 'smtp | brevo | sendgrid | mailgun',
  `brevo_api_key`        varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `brevo_sender_name`    varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `brevo_sender_email`   varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sendgrid_api_key`     varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mailgun_api_key`      varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mailgun_domain`       varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sms_provider`         varchar(50)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sms_api_key`          text         COLLATE utf8mb4_unicode_ci,
  `sms_api_secret`       text         COLLATE utf8mb4_unicode_ci,
  `sms_from`             varchar(50)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sms_enabled`          tinyint(1)   DEFAULT '0',
  `sms_provider_type`    varchar(30)  COLLATE utf8mb4_unicode_ci DEFAULT 'infobip' COMMENT 'infobip | apifon | routee | vonage | twilio | bsms | yuboto',
  `infobip_api_key`      varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `infobip_base_url`     varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `apifon_api_key`       varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `apifon_sender`        varchar(20)  COLLATE utf8mb4_unicode_ci DEFAULT 'FishBill',
  `routee_api_key`       varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `routee_sender_id`     varchar(20)  COLLATE utf8mb4_unicode_ci DEFAULT 'FishBill',
  `vonage_api_key`       varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `vonage_api_secret`    varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `twilio_account_sid`   varchar(50)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `twilio_auth_token`    varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `twilio_from_number`   varchar(20)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bsms_api_key`         varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `yuboto_api_key`       varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notif_invoice_created`     tinyint(1)   DEFAULT '1',
  `notif_invoice_transmitted` tinyint(1)   DEFAULT '1',
  `notif_invoice_failed`      tinyint(1)   DEFAULT '1',
  `notif_daily_summary`       tinyint(1)   DEFAULT '0',
  `theme_accent`         varchar(20)  COLLATE utf8mb4_unicode_ci DEFAULT 'blue',
  `invoice_footer`       text         COLLATE utf8mb4_unicode_ci,
  `default_due_days`     int          DEFAULT '30',
  `auto_transmit`        tinyint(1)   DEFAULT '0',
  `iris_enabled`         tinyint(1)   NOT NULL DEFAULT '0',
  `iris_iban`            varchar(34)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `iris_beneficiary`     varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `iris_bank_name`       varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `iris_mobile`          varchar(20)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `iris_bic`             varchar(11)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `iris_instructions`    text         COLLATE utf8mb4_unicode_ci,
  `feature_customers`    tinyint(1)   NOT NULL DEFAULT '0',
  `feature_ospa`         tinyint(1)   NOT NULL DEFAULT '0',
  `feature_weighing_slips` tinyint(1) NOT NULL DEFAULT '0',
  `default_vat_rate`     tinyint      NOT NULL DEFAULT '13',
  `created_at`           datetime     DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `business_id` (`business_id`),
  CONSTRAINT `business_settings_ibfk_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- delivery_notes  (FK → businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `delivery_notes` (
  `id`                char(36)     COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id`       char(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  `series`            varchar(10)  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ΔΑ',
  `number`            int          NOT NULL DEFAULT '0',
  `issue_date`        date         NOT NULL,
  `dispatch_date`     date         DEFAULT NULL,
  `dispatch_time`     time         DEFAULT NULL,
  `recipient_name`    varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `recipient_afm`     varchar(20)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recipient_doy`     varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recipient_address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recipient_city`    varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recipient_postal`  varchar(20)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recipient_phone`   varchar(30)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dispatch_location` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `loading_place`     varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transport_purpose` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `for_weighing`      tinyint(1)   NOT NULL DEFAULT '0',
  `delivery_location` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `vehicle_plate`     varchar(30)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes`             text         COLLATE utf8mb4_unicode_ci,
  `status`            varchar(30)  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `mydata_mark`       varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mydata_uid`        varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mydata_response`   text         COLLATE utf8mb4_unicode_ci,
  `transmitted_at`    datetime     DEFAULT NULL,
  `pdf_path`          varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `client_ref`        varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by`        char(36)     COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at`        datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dn_business` (`business_id`),
  KEY `idx_dn_status` (`status`),
  KEY `idx_dn_date` (`issue_date`),
  KEY `idx_dn_client_ref` (`business_id`,`client_ref`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- delivery_note_lines  (FK → delivery_notes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `delivery_note_lines` (
  `id`               char(36)      COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `delivery_note_id` char(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order`       tinyint       NOT NULL DEFAULT '0',
  `description`      varchar(500)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity`         decimal(12,4) NOT NULL DEFAULT '0.0000',
  `unit`             varchar(20)   COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'kg',
  `unit_price`       decimal(12,4) NOT NULL DEFAULT '0.0000',
  `vat_rate`         decimal(5,2)  NOT NULL DEFAULT '0.00',
  `net_amount`       decimal(12,4) NOT NULL DEFAULT '0.0000',
  PRIMARY KEY (`id`),
  KEY `idx_dnl_note` (`delivery_note_id`),
  CONSTRAINT `fk_dnl_note` FOREIGN KEY (`delivery_note_id`) REFERENCES `delivery_notes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- dn_credit_requests  (FK → businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dn_credit_requests` (
  `id`              char(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  `business_id`     char(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  `credits`         int           NOT NULL DEFAULT '10',
  `amount_eur`      decimal(6,2)  NOT NULL DEFAULT '0.00',
  `status`          enum('pending','granted','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `notes`           text          COLLATE utf8mb4_unicode_ci,
  `requested_at`    datetime      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `resolved_at`     datetime      DEFAULT NULL,
  `resolved_by`     char(36)      COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invoice_credits` int           NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `fk_dcr_biz` (`business_id`),
  CONSTRAINT `fk_dcr_biz` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- employee_businesses  (FK → users, businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `employee_businesses` (
  `id`          char(36)  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `employee_id` char(36)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `business_id` char(36)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `assigned_by` char(36)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `assigned_at` datetime  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_emp_biz` (`employee_id`,`business_id`),
  KEY `fk_eb_biz` (`business_id`),
  CONSTRAINT `fk_eb_biz` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_eb_emp` FOREIGN KEY (`employee_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- employee_privileges  (no FK constraints — user_id loosely linked)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `employee_privileges` (
  `id`          char(36)  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `user_id`     char(36)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `business_id` char(36)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `privileges`  json      DEFAULT NULL,
  `granted_by`  char(36)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `granted_at`  datetime  DEFAULT NULL,
  `updated_at`  datetime  DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_employee_user` (`user_id`),
  KEY `idx_ep_business` (`business_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- integration_logs  (FK → businesses ON DELETE SET NULL)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `integration_logs` (
  `id`          char(36)     COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id` char(36)     COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `service`     varchar(50)  COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'brevo | infobip | apifon | ...',
  `event_type`  varchar(50)  COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'email_sent | sms_sent | invoice_transmitted | ...',
  `status`      enum('success','failed','pending') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `request_ref` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recipient`   varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error_msg`   text         COLLATE utf8mb4_unicode_ci,
  `meta`        json         DEFAULT NULL,
  `created_at`  datetime     DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_intlog_biz_service` (`business_id`,`service`),
  KEY `idx_intlog_event` (`event_type`,`status`),
  KEY `idx_intlog_date` (`created_at`),
  CONSTRAINT `fk_intlog_biz` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- iris_payments  (FK → businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `iris_payments` (
  `id`             char(36)      COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id`    char(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  `invoice_id`     char(36)      COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount`         decimal(12,2) NOT NULL,
  `description`    varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payer_name`     varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payer_mobile`   varchar(20)   COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reference_code` varchar(50)   COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `iban`           varchar(34)   COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qr_url`         text          COLLATE utf8mb4_unicode_ci,
  `status`         enum('pending','paid','expired','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `expires_at`     datetime      DEFAULT NULL,
  `paid_at`        datetime      DEFAULT NULL,
  `metadata`       json          DEFAULT NULL,
  `created_at`     datetime      DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     datetime      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_iris_ref` (`reference_code`),
  KEY `idx_iris_business` (`business_id`),
  KEY `idx_iris_invoice` (`invoice_id`),
  KEY `idx_iris_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- ospa_submissions  (FK → businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `ospa_submissions` (
  `id`                char(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  `business_id`       char(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  `submission_period` varchar(20)  COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'e.g. 2026-04',
  `status`            enum('pending','submitted','needs_correction') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `form_path`         varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `supporting_docs`   json         DEFAULT NULL,
  `submission_date`   date         DEFAULT NULL,
  `deadline`          date         DEFAULT NULL,
  `notes`             text         COLLATE utf8mb4_unicode_ci,
  `created_at`        datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ospa_business` (`business_id`),
  KEY `idx_ospa_period` (`submission_period`),
  CONSTRAINT `fk_ospa_business` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- payment_calls  (FK → businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `payment_calls` (
  `id`              char(36)     COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id`     char(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone_number`    varchar(30)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `called_by`       char(36)     COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `called_by_name`  varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `called_at`       datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `duration_minutes` smallint    DEFAULT NULL,
  `outcome`         enum('answered','no_answer','voicemail','busy','wrong_number','callback_scheduled') COLLATE utf8mb4_unicode_ci DEFAULT 'answered',
  `reason`          enum('payment_reminder','payment_received','onboarding','support','other') COLLATE utf8mb4_unicode_ci DEFAULT 'payment_reminder',
  `notes`           text         COLLATE utf8mb4_unicode_ci,
  `follow_up_at`    datetime     DEFAULT NULL,
  `created_at`      datetime     DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pc_business` (`business_id`),
  KEY `idx_pc_called_at` (`called_at`),
  KEY `idx_pc_followup` (`follow_up_at`),
  CONSTRAINT `fk_pc_business` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- platform_settings  (no FK — global admin key/value store)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `platform_settings` (
  `id`            int          NOT NULL AUTO_INCREMENT,
  `setting_key`   varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `setting_value` text         COLLATE utf8mb4_unicode_ci,
  `updated_at`    datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`),
  KEY `idx_platform_settings_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default platform settings (values configured by admin via UI)
INSERT IGNORE INTO `platform_settings` (`setting_key`, `setting_value`) VALUES
  ('maintenance_mode',    '0'),
  ('maintenance_message', 'Εκτελούνται εργασίες συντήρησης. Σύντομα θα είμαστε πάλι κοντά σας.'),
  ('web_base_url',        NULL),
  ('app_base_url',        NULL);

-- ---------------------------------------------------------------------------
-- sms_reminders  (FK → businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sms_reminders` (
  `id`           char(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  `business_id`  char(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone_number` varchar(30)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `sent_by`      char(36)     COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sent_by_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sent_at`      datetime     NOT NULL,
  `reason`       enum('trial_expiring','subscription_expiring','payment_reminder','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'trial_expiring',
  `notes`        text         COLLATE utf8mb4_unicode_ci,
  `created_at`   datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_sms_rem_biz` (`business_id`),
  CONSTRAINT `fk_sms_rem_biz` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- webhooks  (FK → businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `webhooks` (
  `id`          char(36)     COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id` char(36)     COLLATE utf8mb4_unicode_ci NOT NULL,
  `name`        varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `url`         varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `secret`      varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'HMAC secret for signature verification',
  `events`      json         NOT NULL COMMENT '["invoice.created","invoice.transmitted","payment.received"]',
  `is_active`   tinyint(1)   DEFAULT '1',
  `last_fired`  datetime     DEFAULT NULL,
  `created_at`  datetime     DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_webhook_biz` (`business_id`),
  CONSTRAINT `fk_webhook_biz` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- weighing_slips  (FK → businesses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `weighing_slips` (
  `id`                 char(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  `business_id`        char(36)      COLLATE utf8mb4_unicode_ci NOT NULL,
  `mobile_id`          int           DEFAULT NULL,
  `slip_number`        int           NOT NULL DEFAULT '0',
  `slip_date`          date          NOT NULL,
  `fish_type`          varchar(100)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `fao_code`           varchar(10)   COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `individual_count`   int           DEFAULT NULL,
  `presentation_code`  varchar(10)   COLLATE utf8mb4_unicode_ci DEFAULT 'WHL',
  `weight_kg`          decimal(10,4) NOT NULL DEFAULT '0.0000',
  `buyer_name`         varchar(255)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `price_per_kg`       decimal(10,4) NOT NULL DEFAULT '0.0000',
  `total_amount`       decimal(10,4) NOT NULL DEFAULT '0.0000',
  `image_path`         varchar(500)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes`              text          COLLATE utf8mb4_unicode_ci,
  `created_at`         datetime      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         datetime      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ws_business` (`business_id`),
  KEY `idx_ws_date` (`slip_date`),
  KEY `idx_ws_fish` (`fish_type`),
  CONSTRAINT `fk_ws_business` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
