-- MySQL dump 10.13  Distrib 8.0.36, for Win64 (x86_64)
--
-- Host: 127.0.0.1    Database: fishbill_db
-- ------------------------------------------------------
-- Server version	8.0.36

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `accountant_clients`
--

DROP TABLE IF EXISTS `accountant_clients`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `accountant_clients` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `accountant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `business_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `added_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_ac` (`accountant_id`,`business_id`),
  KEY `idx_accountant` (`accountant_id`),
  KEY `idx_business` (`business_id`),
  CONSTRAINT `accountant_clients_ibfk_1` FOREIGN KEY (`accountant_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `accountant_clients_ibfk_2` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `accountant_clients`
--

LOCK TABLES `accountant_clients` WRITE;
/*!40000 ALTER TABLE `accountant_clients` DISABLE KEYS */;
INSERT INTO `accountant_clients` VALUES ('515ddce2-30f1-11f1-817e-74563ce13681','405ee2da-30f1-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681',NULL,'2026-04-05 16:14:03');
/*!40000 ALTER TABLE `accountant_clients` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `business_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `entity_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `old_values` json DEFAULT NULL,
  `new_values` json DEFAULT NULL,
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_business` (`business_id`),
  KEY `idx_action` (`action`),
  KEY `idx_entity` (`entity_type`,`entity_id`),
  KEY `idx_date` (`created_at`),
  FULLTEXT KEY `ft_audit_logs` (`action`,`description`)
) ENGINE=InnoDB AUTO_INCREMENT=34 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_logs`
--

LOCK TABLES `audit_logs` WRITE;
/*!40000 ALTER TABLE `audit_logs` DISABLE KEYS */;
INSERT INTO `audit_logs` VALUES (1,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'UPDATE_BUSINESS','business','01fdd0b5-2f31-11f1-817e-74563ce13681','PUT /api/businesses/01fdd0b5-2f31-11f1-817e-74563ce13681 - HTTP 400',NULL,NULL,'::ffff:127.0.0.1',NULL,'2026-04-03 10:50:19'),(2,'02206334-2f31-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681','UPDATE_USER','user','02206334-2f31-11f1-817e-74563ce13681','PUT /api/users/02206334-2f31-11f1-817e-74563ce13681 - HTTP 200',NULL,NULL,'::ffff:192.168.1.6',NULL,'2026-04-03 11:56:11'),(3,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'CREATE_USER','user',NULL,'POST /api/users - HTTP 400',NULL,NULL,'::ffff:127.0.0.1',NULL,'2026-04-03 15:04:35'),(4,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'CREATE_USER','user',NULL,'POST /api/users - HTTP 400',NULL,NULL,'::ffff:127.0.0.1',NULL,'2026-04-03 15:04:36'),(5,'02206334-2f31-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681','UPDATE_USER','user','02206334-2f31-11f1-817e-74563ce13681','PUT /api/users/02206334-2f31-11f1-817e-74563ce13681 - HTTP 200',NULL,NULL,'::ffff:192.168.1.6',NULL,'2026-04-04 02:38:54'),(6,'02206334-2f31-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681','CREATE_INVOICE','invoice',NULL,'POST /api/invoices - HTTP 403',NULL,NULL,'::ffff:192.168.1.6',NULL,'2026-04-04 16:13:01'),(7,'02206334-2f31-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681','CREATE_INVOICE','invoice',NULL,'POST /api/invoices - HTTP 403',NULL,NULL,'::ffff:192.168.1.6',NULL,'2026-04-04 16:13:01'),(8,'02206334-2f31-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681','CREATE_INVOICE','invoice',NULL,'POST /api/invoices - HTTP 403',NULL,NULL,'::ffff:192.168.1.6',NULL,'2026-04-04 16:13:01'),(9,'02206334-2f31-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681','CREATE_INVOICE','invoice',NULL,'POST /api/invoices - HTTP 403',NULL,NULL,'::ffff:192.168.1.6',NULL,'2026-04-05 00:32:49'),(10,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'UPDATE_USER','user','f3273c4a-2f37-11f1-817e-74563ce13681','PUT /api/users/f3273c4a-2f37-11f1-817e-74563ce13681 - HTTP 200',NULL,NULL,'::ffff:127.0.0.1',NULL,'2026-04-05 01:24:35'),(11,'02206334-2f31-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681','CREATE_INVOICE','invoice',NULL,'POST /api/invoices - HTTP 201',NULL,NULL,'::ffff:192.168.1.6',NULL,'2026-04-05 01:27:32'),(12,'02206334-2f31-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681','UPDATE_INVOICE','invoice','7947bf94-3075-11f1-817e-74563ce13681','PUT /api/invoices/7947bf94-3075-11f1-817e-74563ce13681 - HTTP 200',NULL,NULL,'::ffff:192.168.1.6',NULL,'2026-04-05 01:28:14'),(13,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'UPDATE_USER','user','f3273c4a-2f37-11f1-817e-74563ce13681','PUT /api/users/f3273c4a-2f37-11f1-817e-74563ce13681 - HTTP 200',NULL,NULL,'::ffff:127.0.0.1',NULL,'2026-04-05 01:29:46'),(14,'02206334-2f31-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681','DELETE_INVOICE','invoice','undefined','DELETE /api/invoices/undefined - HTTP 404',NULL,NULL,'::1',NULL,'2026-04-06 14:36:52'),(15,'02206334-2f31-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681','DELETE_INVOICE','invoice','undefined','DELETE /api/invoices/undefined - HTTP 404',NULL,NULL,'::1',NULL,'2026-04-06 14:47:55'),(16,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'UPDATE_USER','user','02206334-2f31-11f1-817e-74563ce13681','PUT /api/users/02206334-2f31-11f1-817e-74563ce13681 - HTTP 200',NULL,NULL,'::1',NULL,'2026-04-08 03:01:05'),(17,'02206334-2f31-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681','DELETE_INVOICE','invoice','undefined','DELETE /api/invoices/undefined - HTTP 404',NULL,NULL,'::1',NULL,'2026-04-08 03:33:00'),(18,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'DELETE_USER','user','02206334-2f31-11f1-817e-74563ce13681','DELETE /api/users/02206334-2f31-11f1-817e-74563ce13681 - HTTP 200',NULL,NULL,'127.0.0.1',NULL,'2026-04-08 15:54:43'),(19,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'DELETE_USER','user','f3273c4a-2f37-11f1-817e-74563ce13681','DELETE /api/users/f3273c4a-2f37-11f1-817e-74563ce13681 - HTTP 200',NULL,NULL,'127.0.0.1',NULL,'2026-04-08 15:54:47'),(20,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'DELETE_USER','user','02206334-2f31-11f1-817e-74563ce13681','DELETE /api/users/02206334-2f31-11f1-817e-74563ce13681 - HTTP 200',NULL,NULL,'127.0.0.1',NULL,'2026-04-08 15:54:53'),(21,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'DELETE_USER','user','405ee2da-30f1-11f1-817e-74563ce13681','DELETE /api/users/405ee2da-30f1-11f1-817e-74563ce13681 - HTTP 200',NULL,NULL,'127.0.0.1',NULL,'2026-04-08 15:54:59'),(22,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'DELETE_USER','user','b3587d41-3282-11f1-befc-74563ce13681','DELETE /api/users/b3587d41-3282-11f1-befc-74563ce13681 - HTTP 200',NULL,NULL,'127.0.0.1',NULL,'2026-04-08 15:55:02'),(23,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'UPDATE_USER','user','b3587d41-3282-11f1-befc-74563ce13681','PUT /api/users/b3587d41-3282-11f1-befc-74563ce13681 - HTTP 200',NULL,NULL,'127.0.0.1',NULL,'2026-04-08 15:55:12'),(24,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'UPDATE_USER','user','405ee2da-30f1-11f1-817e-74563ce13681','PUT /api/users/405ee2da-30f1-11f1-817e-74563ce13681 - HTTP 200',NULL,NULL,'127.0.0.1',NULL,'2026-04-08 15:55:15'),(25,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'UPDATE_USER','user','f3273c4a-2f37-11f1-817e-74563ce13681','PUT /api/users/f3273c4a-2f37-11f1-817e-74563ce13681 - HTTP 200',NULL,NULL,'127.0.0.1',NULL,'2026-04-08 15:55:17'),(26,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'UPDATE_USER','user','02206334-2f31-11f1-817e-74563ce13681','PUT /api/users/02206334-2f31-11f1-817e-74563ce13681 - HTTP 200',NULL,NULL,'127.0.0.1',NULL,'2026-04-08 15:55:18'),(27,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'CREATE_CUSTOMER','customer',NULL,'POST /api/customers - HTTP 500',NULL,NULL,'127.0.0.1',NULL,'2026-04-08 23:28:58'),(28,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'CREATE_CUSTOMER','customer',NULL,'POST /api/customers - HTTP 500',NULL,NULL,'127.0.0.1',NULL,'2026-04-08 23:29:03'),(29,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'CREATE_CUSTOMER','customer',NULL,'POST /api/customers - HTTP 500',NULL,NULL,'127.0.0.1',NULL,'2026-04-08 23:29:04'),(30,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'CREATE_CUSTOMER','customer',NULL,'POST /api/customers - HTTP 500',NULL,NULL,'127.0.0.1',NULL,'2026-04-08 23:29:04'),(31,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'CREATE_CUSTOMER','customer',NULL,'POST /api/customers - HTTP 500',NULL,NULL,'127.0.0.1',NULL,'2026-04-08 23:29:04'),(32,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'CREATE_CUSTOMER','customer',NULL,'POST /api/customers - HTTP 500',NULL,NULL,'127.0.0.1',NULL,'2026-04-08 23:29:09'),(33,'9a147741-2edf-11f1-817e-74563ce13681',NULL,'CREATE_CUSTOMER','customer',NULL,'POST /api/customers - HTTP 500',NULL,NULL,'127.0.0.1',NULL,'2026-04-08 23:29:10');
/*!40000 ALTER TABLE `audit_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `backup_logs`
--

DROP TABLE IF EXISTS `backup_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `backup_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `initiated_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `filename` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `size_bytes` bigint DEFAULT NULL,
  `file_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_size` bigint DEFAULT NULL,
  `type` enum('auto','manual') COLLATE utf8mb4_unicode_ci DEFAULT 'auto',
  `status` enum('running','success','failed') COLLATE utf8mb4_unicode_ci DEFAULT 'running',
  `error_msg` text COLLATE utf8mb4_unicode_ci,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `started_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `finished_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_backup_initiated_by` (`initiated_by`),
  CONSTRAINT `fk_backup_initiated_by` FOREIGN KEY (`initiated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `backup_logs`
--

LOCK TABLES `backup_logs` WRITE;
/*!40000 ALTER TABLE `backup_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `backup_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bug_reports`
--

DROP TABLE IF EXISTS `bug_reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bug_reports` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `reporter_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'accountant user id',
  `category` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `steps` text COLLATE utf8mb4_unicode_ci,
  `severity` enum('low','medium','high','critical') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'medium',
  `status` enum('open','in_progress','resolved','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `admin_notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bug_reporter` (`reporter_id`),
  KEY `idx_bug_status` (`status`),
  KEY `idx_bug_severity` (`severity`),
  CONSTRAINT `fk_bug_reporter` FOREIGN KEY (`reporter_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bug_reports`
--

LOCK TABLES `bug_reports` WRITE;
/*!40000 ALTER TABLE `bug_reports` DISABLE KEYS */;
/*!40000 ALTER TABLE `bug_reports` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `business_settings`
--

DROP TABLE IF EXISTS `business_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `business_settings` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `smtp_host` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `smtp_port` smallint DEFAULT '587',
  `smtp_user` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `smtp_pass` text COLLATE utf8mb4_unicode_ci,
  `smtp_from_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `smtp_from_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `smtp_secure` tinyint(1) DEFAULT '0',
  `email_enabled` tinyint(1) DEFAULT '0',
  `sms_provider` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'twilio|nexmo|custom',
  `sms_api_key` text COLLATE utf8mb4_unicode_ci,
  `sms_api_secret` text COLLATE utf8mb4_unicode_ci,
  `sms_from` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sms_enabled` tinyint(1) DEFAULT '0',
  `notif_invoice_created` tinyint(1) DEFAULT '1',
  `notif_invoice_transmitted` tinyint(1) DEFAULT '1',
  `notif_invoice_failed` tinyint(1) DEFAULT '1',
  `notif_daily_summary` tinyint(1) DEFAULT '0',
  `theme_accent` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'blue',
  `invoice_footer` text COLLATE utf8mb4_unicode_ci,
  `default_due_days` int DEFAULT '30',
  `auto_transmit` tinyint(1) DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `email_provider` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT 'smtp' COMMENT 'smtp | brevo | sendgrid | mailgun',
  `brevo_api_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `brevo_sender_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `brevo_sender_email` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sendgrid_api_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mailgun_api_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mailgun_domain` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sms_provider_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT 'infobip' COMMENT 'infobip | apifon | routee | vonage | twilio | bsms | yuboto',
  `infobip_api_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `infobip_base_url` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'e.g. xxxxx.api.infobip.com',
  `apifon_api_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `apifon_sender` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'FishBill',
  `routee_api_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `routee_sender_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'FishBill',
  `vonage_api_key` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `vonage_api_secret` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `twilio_account_sid` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `twilio_auth_token` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `twilio_from_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bsms_api_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `yuboto_api_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `business_id` (`business_id`),
  CONSTRAINT `business_settings_ibfk_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `business_settings`
--

LOCK TABLES `business_settings` WRITE;
/*!40000 ALTER TABLE `business_settings` DISABLE KEYS */;
INSERT INTO `business_settings` VALUES ('a5c43034-2f3a-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681',NULL,587,NULL,NULL,NULL,NULL,0,0,NULL,NULL,NULL,NULL,0,1,0,0,0,'blue',NULL,30,0,'2026-04-03 11:53:56','2026-04-06 14:33:03','smtp',NULL,NULL,NULL,NULL,NULL,NULL,'infobip',NULL,NULL,NULL,'FishBill',NULL,'FishBill',NULL,NULL,NULL,NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `business_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `businesses`
--

DROP TABLE IF EXISTS `businesses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `businesses` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `afm` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Tax ID',
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Company name',
  `trade_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Trade name',
  `doy` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Tax office',
  `address` text COLLATE utf8mb4_unicode_ci,
  `city` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `postal_code` varchar(5) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `activity_code` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT '03.11',
  `vat_regime` enum('normal','small_business','exempt') COLLATE utf8mb4_unicode_ci DEFAULT 'normal',
  `invoice_series` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT 'A',
  `invoice_counter` int DEFAULT '0',
  `receipt_series` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT 'B',
  `receipt_counter` int DEFAULT '0',
  `mydata_user_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mydata_subscription_key` text COLLATE utf8mb4_unicode_ci,
  `provider_name` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `provider_api_key` text COLLATE utf8mb4_unicode_ci,
  `provider_api_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `provider_username` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `provider_password` text COLLATE utf8mb4_unicode_ci,
  `plan` enum('trial','basic','pro','enterprise') COLLATE utf8mb4_unicode_ci DEFAULT 'trial',
  `trial_ends_at` datetime DEFAULT NULL,
  `subscription_active` tinyint(1) DEFAULT '0',
  `subscription_ends_at` datetime DEFAULT NULL,
  `stripe_customer_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `is_suspended` tinyint(1) DEFAULT '0',
  `suspend_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accountant_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accountant_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `accountant_phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `mydata_provider` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT 'direct' COMMENT 'direct | softone | epsilonnet | unidoc | entersoft | singular | megasoft',
  `softone_api_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `softone_api_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT 'https://api.softone.gr/api/mydata',
  `softone_username` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `softone_password` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `softone_company_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `epsilonnet_api_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `epsilonnet_api_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT 'https://mydata.epsilonnet.gr/api',
  `epsilonnet_username` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `epsilonnet_password` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `unidoc_api_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `unidoc_api_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT 'https://api.unidoc.gr/v1',
  `unidoc_username` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `unidoc_password` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gsis_username` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gsis_password` text COLLATE utf8mb4_unicode_ci,
  `auto_renew` tinyint(1) DEFAULT '1' COMMENT '1 = auto-renew enabled, 0 = will cancel at period end',
  `fisherman_code` char(6) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '6-digit unique code shown to fisherman, used by accountant to link',
  PRIMARY KEY (`id`),
  UNIQUE KEY `afm` (`afm`),
  UNIQUE KEY `fisherman_code` (`fisherman_code`),
  KEY `idx_afm` (`afm`),
  KEY `idx_plan` (`plan`),
  KEY `idx_active` (`is_active`),
  KEY `idx_businesses_fisherman_code` (`fisherman_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `businesses`
--

LOCK TABLES `businesses` WRITE;
/*!40000 ALTER TABLE `businesses` DISABLE KEYS */;
INSERT INTO `businesses` VALUES ('01fdd0b5-2f31-11f1-817e-74563ce13681','176091030','κοτσοργιος',NULL,NULL,'εργατικές κατοικίες','Μεσολόγγι',NULL,NULL,NULL,'03.11','normal','A',0,'B',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'basic','2026-05-05 01:25:57',0,NULL,NULL,1,0,NULL,NULL,NULL,NULL,'2026-04-03 10:44:55','2026-04-08 23:30:57','direct',NULL,'https://api.softone.gr/api/mydata',NULL,NULL,NULL,NULL,'https://mydata.epsilonnet.gr/api',NULL,NULL,NULL,'https://api.unidoc.gr/v1',NULL,NULL,NULL,NULL,1,'687017'),('b33508c8-3282-11f1-befc-74563ce13681','072625078','ppp',NULL,NULL,NULL,'ΜΕΣΟΛΟΓΓΙ',NULL,NULL,NULL,'03.11','normal','A',0,'B',0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'trial','2026-05-07 16:07:15',0,NULL,NULL,1,0,NULL,NULL,NULL,NULL,'2026-04-07 16:07:15','2026-04-08 23:30:54','direct',NULL,'https://api.softone.gr/api/mydata',NULL,NULL,NULL,NULL,'https://mydata.epsilonnet.gr/api',NULL,NULL,NULL,'https://api.unidoc.gr/v1',NULL,NULL,NULL,NULL,1,'495738');
/*!40000 ALTER TABLE `businesses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `customers`
--

DROP TABLE IF EXISTS `customers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customers` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `afm` varchar(9) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Tax ID (for B2B)',
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `trade_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `city` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `postal_code` varchar(5) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `country` char(2) COLLATE utf8mb4_unicode_ci DEFAULT 'GR',
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `default_payment_method` enum('cash','bank','check','credit') COLLATE utf8mb4_unicode_ci DEFAULT 'cash',
  `is_favorite` tinyint(1) DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `total_invoices` int DEFAULT '0',
  `total_amount` decimal(12,2) DEFAULT '0.00',
  `last_invoice_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_business` (`business_id`),
  KEY `idx_afm` (`afm`),
  KEY `idx_name` (`name`),
  KEY `idx_favorite` (`is_favorite`),
  FULLTEXT KEY `ft_customers` (`name`,`afm`,`email`,`phone`,`city`),
  CONSTRAINT `customers_ibfk_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customers`
--

LOCK TABLES `customers` WRITE;
/*!40000 ALTER TABLE `customers` DISABLE KEYS */;
INSERT INTO `customers` VALUES ('79458562-3075-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681','176091030','Kotsorgios',NULL,NULL,NULL,NULL,'GR',NULL,NULL,'cash',0,1,0,0.00,NULL,'2026-04-05 01:27:32','2026-04-05 01:27:32');
/*!40000 ALTER TABLE `customers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `integration_logs`
--

DROP TABLE IF EXISTS `integration_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `integration_logs` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `service` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'brevo | infobip | apifon | softone | epsilonnet | unidoc | ...',
  `event_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'email_sent | sms_sent | invoice_transmitted | test_connection | error',
  `status` enum('success','failed','pending') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `request_ref` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'external reference/message ID',
  `recipient` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'email address or phone number',
  `error_msg` text COLLATE utf8mb4_unicode_ci,
  `meta` json DEFAULT NULL COMMENT 'extra data: invoice_id, template_id, cost_units, etc.',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_intlog_biz_service` (`business_id`,`service`),
  KEY `idx_intlog_event` (`event_type`,`status`),
  KEY `idx_intlog_date` (`created_at`),
  CONSTRAINT `fk_intlog_biz` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `integration_logs`
--

LOCK TABLES `integration_logs` WRITE;
/*!40000 ALTER TABLE `integration_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `integration_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `invoice_lines`
--

DROP TABLE IF EXISTS `invoice_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invoice_lines` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `invoice_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `product_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `line_number` int NOT NULL DEFAULT '1',
  `description` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `unit` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'KG',
  `quantity` decimal(10,3) NOT NULL,
  `unit_price` decimal(10,4) NOT NULL,
  `discount_pct` decimal(5,2) DEFAULT '0.00',
  `discount_amt` decimal(10,2) DEFAULT '0.00',
  `net_value` decimal(12,2) NOT NULL,
  `vat_rate` tinyint NOT NULL DEFAULT '13',
  `vat_amount` decimal(12,2) NOT NULL,
  `total_value` decimal(12,2) NOT NULL,
  `income_category` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'E3_561_001',
  `income_type` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT '1.1',
  `income_classification_category` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT 'category1_1' COMMENT 'myDATA income category: category1_1=αγαθά, category1_3=παροχή υπηρεσιών, κλπ.',
  `income_classification_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT 'E3_561_001' COMMENT 'myDATA type: E3_561_001=χονδρική, E3_561_002=λιανική, E3_561_007=λοιπά',
  PRIMARY KEY (`id`),
  KEY `product_id` (`product_id`),
  KEY `idx_invoice` (`invoice_id`),
  CONSTRAINT `invoice_lines_ibfk_1` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE CASCADE,
  CONSTRAINT `invoice_lines_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `invoice_lines`
--

LOCK TABLES `invoice_lines` WRITE;
/*!40000 ALTER TABLE `invoice_lines` DISABLE KEYS */;
INSERT INTO `invoice_lines` VALUES ('924b0717-3075-11f1-817e-74563ce13681','7947bf94-3075-11f1-817e-74563ce13681',NULL,1,'Sardeles','kg',10.000,5.0000,0.00,0.00,50.00,13,6.50,56.50,'E3_561_001','1.1','category1_1','E3_561_001');
/*!40000 ALTER TABLE `invoice_lines` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `invoice_series`
--

DROP TABLE IF EXISTS `invoice_series`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invoice_series` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `series` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invoice_type` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT '1.1',
  `current_number` int DEFAULT '0',
  `is_default` tinyint(1) DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_series` (`business_id`,`series`),
  CONSTRAINT `invoice_series_ibfk_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `invoice_series`
--

LOCK TABLES `invoice_series` WRITE;
/*!40000 ALTER TABLE `invoice_series` DISABLE KEYS */;
INSERT INTO `invoice_series` VALUES ('01feac9a-2f31-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681','A',NULL,'1.1',1,1,1,'2026-04-03 10:44:55'),('b336098b-3282-11f1-befc-74563ce13681','b33508c8-3282-11f1-befc-74563ce13681','A',NULL,'1.1',0,1,1,'2026-04-07 16:07:15');
/*!40000 ALTER TABLE `invoice_series` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `invoices`
--

DROP TABLE IF EXISTS `invoices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invoices` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `series` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `number` int NOT NULL,
  `full_number` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `invoice_type` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT '1.1',
  `issue_date` date NOT NULL DEFAULT (curdate()),
  `issue_time` time NOT NULL DEFAULT (curtime()),
  `due_date` date DEFAULT NULL,
  `payment_method` enum('cash','bank','bank_transfer','check','credit','credit_card','card','iris','other') COLLATE utf8mb4_unicode_ci DEFAULT 'cash',
  `net_value` decimal(12,2) DEFAULT '0.00',
  `vat_amount` decimal(12,2) DEFAULT '0.00',
  `total_value` decimal(12,2) DEFAULT '0.00',
  `discount_amount` decimal(12,2) DEFAULT '0.00',
  `status` enum('draft','issued','pending_retry','transmitted','failed','cancelled') COLLATE utf8mb4_unicode_ci DEFAULT 'draft',
  `mydata_mark` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mydata_uid` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mydata_cancel_mark` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `provider_name` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `provider_reference` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `retry_count` int DEFAULT '0',
  `next_retry_at` datetime DEFAULT NULL,
  `last_error` text COLLATE utf8mb4_unicode_ci,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `pdf_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pdf_generated_at` datetime DEFAULT NULL,
  `transmitted_at` datetime DEFAULT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_invoice` (`business_id`,`series`,`number`),
  KEY `idx_business` (`business_id`),
  KEY `idx_status` (`status`),
  KEY `idx_date` (`issue_date`),
  KEY `idx_mark` (`mydata_mark`),
  KEY `idx_customer` (`customer_id`),
  KEY `idx_created_by` (`created_by`),
  FULLTEXT KEY `ft_invoices` (`full_number`),
  CONSTRAINT `invoices_ibfk_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`),
  CONSTRAINT `invoices_ibfk_2` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `invoices_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `invoices`
--

LOCK TABLES `invoices` WRITE;
/*!40000 ALTER TABLE `invoices` DISABLE KEYS */;
INSERT INTO `invoices` VALUES ('7947bf94-3075-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681','79458562-3075-11f1-817e-74563ce13681','02206334-2f31-11f1-817e-74563ce13681','A',0,'A-000000','1.1','2026-04-04','01:27:32',NULL,'credit_card',50.00,6.50,56.50,0.00,'draft',NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-04-05 01:27:32','2026-04-05 01:28:14');
/*!40000 ALTER TABLE `invoices` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` text COLLATE utf8mb4_unicode_ci,
  `is_read` tinyint(1) DEFAULT '0',
  `action_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_unread` (`user_id`,`is_read`),
  CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notifications`
--

LOCK TABLES `notifications` WRITE;
/*!40000 ALTER TABLE `notifications` DISABLE KEYS */;
/*!40000 ALTER TABLE `notifications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `platform_settings`
--

DROP TABLE IF EXISTS `platform_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `platform_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `setting_value` text COLLATE utf8mb4_unicode_ci,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`),
  KEY `idx_platform_settings_key` (`setting_key`)
) ENGINE=InnoDB AUTO_INCREMENT=31 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `platform_settings`
--

LOCK TABLES `platform_settings` WRITE;
/*!40000 ALTER TABLE `platform_settings` DISABLE KEYS */;
INSERT INTO `platform_settings` VALUES (1,'provider_name','direct','2026-04-03 15:40:43'),(2,'provider_api_url','','2026-04-03 15:40:43'),(3,'provider_api_key','','2026-04-03 15:40:43'),(4,'provider_username','','2026-04-03 15:40:43'),(5,'provider_password','','2026-04-03 15:40:43'),(6,'provider_test_mode','1','2026-04-03 15:40:43'),(7,'provider_notes','','2026-04-03 15:40:43'),(8,'bank_name','Εθνική Τράπεζα','2026-04-03 15:40:43'),(9,'bank_iban','','2026-04-03 15:40:43'),(10,'bank_beneficiary','FishBill OE','2026-04-03 15:40:43'),(11,'bank_reference_template','Συνδρομή {plan} — {email}','2026-04-03 15:40:43'),(12,'cancel_otp_7947bf94-3075-11f1-817e-74563ce13681','{\"otp\":\"668259\",\"expires\":\"2026-04-08T20:42:25.792Z\",\"requested_by\":\"9a147741-2edf-11f1-817e-74563ce13681\"}','2026-04-08 23:27:25'),(17,'delete_token_405ee2da-30f1-11f1-817e-74563ce13681','{\"token\":\"3c4dcb0e29e0ff084a65d5c2d73b8b87052acea78b8ebd959bc80ba4f78fe4ee\",\"expires\":\"2026-04-08T20:58:12.792Z\",\"requested_by\":\"9a147741-2edf-11f1-817e-74563ce13681\"}','2026-04-08 23:28:12'),(18,'platform_expenses','[]','2026-04-08 23:30:13'),(20,'platform_email_provider','brevo','2026-04-09 02:47:29'),(21,'platform_email_from','','2026-04-09 02:47:29'),(22,'platform_email_from_name','','2026-04-09 02:47:29'),(23,'platform_smtp_host','','2026-04-09 02:47:29'),(24,'platform_smtp_port','','2026-04-09 02:47:29'),(25,'platform_smtp_user','','2026-04-09 02:47:29'),(26,'platform_smtp_pass','','2026-04-09 02:47:29'),(27,'platform_brevo_key','','2026-04-09 02:47:29'),(28,'platform_sendgrid_key','','2026-04-09 02:47:29'),(29,'platform_mailgun_key','','2026-04-09 02:47:29'),(30,'platform_mailgun_domain','','2026-04-09 02:47:29');
/*!40000 ALTER TABLE `platform_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `products`
--

DROP TABLE IF EXISTS `products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `products` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'e.g. Sea Bream, Bass',
  `code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `unit` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'KG',
  `default_price` decimal(10,4) DEFAULT NULL,
  `vat_rate` tinyint DEFAULT '13',
  `income_category` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'E3_561_001',
  `income_type` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT '1.1',
  `is_favorite` tinyint(1) DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `sort_order` int DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_business` (`business_id`),
  KEY `idx_name` (`name`),
  FULLTEXT KEY `ft_products` (`name`,`code`,`description`),
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `products`
--

LOCK TABLES `products` WRITE;
/*!40000 ALTER TABLE `products` DISABLE KEYS */;
/*!40000 ALTER TABLE `products` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `subscriptions`
--

DROP TABLE IF EXISTS `subscriptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `subscriptions` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan` enum('basic','pro','enterprise') COLLATE utf8mb4_unicode_ci DEFAULT 'basic',
  `price_eur` decimal(8,2) DEFAULT '10.00',
  `billing_cycle` enum('monthly','annual') COLLATE utf8mb4_unicode_ci DEFAULT 'monthly',
  `stripe_sub_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stripe_payment_method` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','past_due','cancelled','trial') COLLATE utf8mb4_unicode_ci DEFAULT 'trial',
  `trial_ends_at` datetime DEFAULT NULL,
  `current_period_start` datetime DEFAULT NULL,
  `current_period_end` datetime DEFAULT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `business_id` (`business_id`),
  CONSTRAINT `subscriptions_ibfk_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `subscriptions`
--

LOCK TABLES `subscriptions` WRITE;
/*!40000 ALTER TABLE `subscriptions` DISABLE KEYS */;
/*!40000 ALTER TABLE `subscriptions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `transmission_logs`
--

DROP TABLE IF EXISTS `transmission_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transmission_logs` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `invoice_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `provider` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `attempt_number` int DEFAULT '1',
  `request_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `request_payload` longtext COLLATE utf8mb4_unicode_ci,
  `http_status` smallint DEFAULT NULL,
  `response_body` longtext COLLATE utf8mb4_unicode_ci,
  `success` tinyint(1) DEFAULT '0',
  `mydata_mark` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `duration_ms` int DEFAULT NULL,
  `attempted_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_invoice` (`invoice_id`),
  KEY `idx_success` (`success`),
  KEY `idx_date` (`attempted_at`),
  CONSTRAINT `transmission_logs_ibfk_1` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `transmission_logs`
--

LOCK TABLES `transmission_logs` WRITE;
/*!40000 ALTER TABLE `transmission_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `transmission_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `full_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `avatar_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone_verified` tinyint(1) DEFAULT '0',
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('super_admin','owner','accountant','captain','employee') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'owner',
  `can_create_invoice` tinyint(1) DEFAULT '1',
  `can_cancel_invoice` tinyint(1) DEFAULT '0',
  `can_view_all` tinyint(1) DEFAULT '0',
  `can_export` tinyint(1) DEFAULT '0',
  `can_manage_users` tinyint(1) DEFAULT '0',
  `can_view_logs` tinyint(1) DEFAULT '0',
  `last_login_at` datetime DEFAULT NULL,
  `last_login_ip` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `is_verified` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'Accountant verification status. 0=pending, 1=verified by super_admin.',
  `email_verified` tinyint(1) DEFAULT '0',
  `reset_token` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reset_token_expires` datetime DEFAULT NULL,
  `invite_token` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invite_expires` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `notif_new_invoice` tinyint(1) NOT NULL DEFAULT '1' COMMENT 'Email on new invoice from client',
  `notif_mydata_fail` tinyint(1) NOT NULL DEFAULT '1' COMMENT 'Email on myDATA transmission failure',
  `notif_client_new` tinyint(1) NOT NULL DEFAULT '1' COMMENT 'Email when new client links accountant',
  `notif_subscription` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'Email for subscription updates',
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_business` (`business_id`),
  KEY `idx_email` (`email`),
  KEY `idx_role` (`role`),
  KEY `idx_phone` (`phone`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES ('02206334-2f31-11f1-817e-74563ce13681','01fdd0b5-2f31-11f1-817e-74563ce13681','κοτσοργιος Δημήτριοςn','pkotsorgios654@gmail.com','/avatars/02206334-2f31-11f1-817e-74563ce13681_1775473073738.png',NULL,0,'$2b$12$pgj09Ney9bdaZJoXPown4uDIqU8D/.sTjJPCRIyrdJpPnb8TiNjvS','owner',1,0,0,0,0,0,'2026-04-08 11:59:09','::1',1,1,0,NULL,NULL,NULL,NULL,'2026-04-03 10:44:56','2026-04-08 15:55:18',1,1,1,0),('405ee2da-30f1-11f1-817e-74563ce13681',NULL,'ΠΑΝΑΓΙΩΤΗΣ ΚΟΤΣΟΡΓΙΟΣ','opengplms@gmail.com',NULL,'6986788178',0,'$2b$12$wDWVOR8QBaUwmaXUo1B//eqCUwxSrERHRe7KXg7KDCwpBriMXikpe','accountant',1,0,0,0,0,0,'2026-04-09 12:15:26','127.0.0.1',1,1,0,NULL,NULL,NULL,NULL,'2026-04-05 16:13:35','2026-04-09 12:15:26',1,1,1,1),('9a147741-2edf-11f1-817e-74563ce13681',NULL,'Super Admin','admin@fishbill.gr',NULL,NULL,0,'$2b$12$Gil9s7yeIoHwmYnTGBbdzuzNzIgq/8eRRVJoe7iuv7PLL4/YBpWKm','super_admin',1,0,1,1,1,1,'2026-04-09 02:48:17','127.0.0.1',1,1,1,NULL,NULL,NULL,NULL,'2026-04-03 00:02:12','2026-04-09 02:48:17',1,1,1,0),('b3587d41-3282-11f1-befc-74563ce13681','b33508c8-3282-11f1-befc-74563ce13681','ΠΑΝΑΓΙΩΤΗΣ ΚΟΤΣΟΡΓΙΟΣ','nolifeprogrammer1@gmail.com',NULL,NULL,0,'$2b$12$wrA2GUGgEjetpC/9jtlDUOcS37lNoMqlinw71cL4hyH0iV5kn8.km','owner',1,0,0,0,0,0,NULL,NULL,1,1,0,NULL,NULL,NULL,NULL,'2026-04-07 16:07:16','2026-04-08 15:55:12',1,1,1,0),('f3273c4a-2f37-11f1-817e-74563ce13681',NULL,'Giorgis Logistis','logistis@test.gr',NULL,NULL,0,'$2b$12$KAHtXL8OqySlyiTKhXnpMOTTabRM5Q8ZHYPqVliqU/OuATMgPTBGS','accountant',1,0,0,0,0,0,'2026-04-03 11:35:19','::1',1,1,0,NULL,NULL,NULL,NULL,'2026-04-03 11:34:37','2026-04-08 15:55:27',1,1,1,0);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `webhooks`
--

DROP TABLE IF EXISTS `webhooks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `webhooks` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT (uuid()),
  `business_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `url` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `secret` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'HMAC secret for signature verification',
  `events` json NOT NULL COMMENT '["invoice.created","invoice.transmitted","payment.received"]',
  `is_active` tinyint(1) DEFAULT '1',
  `last_fired` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_webhook_biz` (`business_id`),
  CONSTRAINT `fk_webhook_biz` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `webhooks`
--

LOCK TABLES `webhooks` WRITE;
/*!40000 ALTER TABLE `webhooks` DISABLE KEYS */;
/*!40000 ALTER TABLE `webhooks` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping events for database 'fishbill_db'
--

--
-- Dumping routines for database 'fishbill_db'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-04-09 12:28:07
