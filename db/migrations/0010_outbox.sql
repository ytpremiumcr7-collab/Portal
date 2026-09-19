-- ARES 0010: transactional domain outbox + notification status distinctions.
-- MySQL-valid.

CREATE TABLE IF NOT EXISTS `domain_outbox` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `aggregate_type` varchar(80) NOT NULL,
  `aggregate_id` bigint unsigned NOT NULL,
  `event_type` varchar(80) NOT NULL,
  `payload` json NOT NULL,
  `status` enum('PENDING','PROCESSING','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
  `attempts` int NOT NULL DEFAULT 0,
  `next_attempt_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processed_at` timestamp NULL DEFAULT NULL,
  `last_error` text NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `outbox_tenant_id_uq` (`tenant_id`,`id`),
  KEY `outbox_pending_idx` (`status`,`next_attempt_at`),
  KEY `outbox_agg_idx` (`tenant_id`,`aggregate_type`,`aggregate_id`),
  CONSTRAINT `outbox_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Extend notificaciones.estado with REGISTRADA / ENVIADA_EXTERNA (idempotent-ish)
ALTER TABLE `notificaciones`
  MODIFY COLUMN `estado` enum('BORRADOR','REGISTRADA','ENVIADA','ENVIADA_EXTERNA','ENTREGADA','FALLIDA','ACKNOWLEDGED') NOT NULL DEFAULT 'BORRADOR';
