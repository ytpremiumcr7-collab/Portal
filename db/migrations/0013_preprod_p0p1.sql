-- Piedra Angular 0013: pre-prod P0/P1 — desempate, break-glass, audit heads, outbox lease, soft-delete participación
-- MySQL/MariaDB-valid. Idempotent where practical.

-- 1) actos_desempate (sorteo_documentado)
CREATE TABLE IF NOT EXISTS `actos_desempate` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `metodo` enum('SORTEO_DOCUMENTADO','OTRO') NOT NULL DEFAULT 'SORTEO_DOCUMENTADO',
  `semilla` varchar(128) NULL,
  `resultado_json` json NULL,
  `evidencia_doc_id` bigint unsigned NULL,
  `actores_json` json NULL,
  `resultado_hash` varchar(64) NULL,
  `estado` enum('BORRADOR','EMITIDO','REGISTRADO','ANULADO') NOT NULL DEFAULT 'BORRADOR',
  `emitido_por` bigint unsigned NULL,
  `registrado_por` bigint unsigned NULL,
  `registrado_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `acto_desemp_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `acto_desemp_lic_uq` (`tenant_id`,`licitacion_id`),
  KEY `acto_desemp_estado_idx` (`tenant_id`,`estado`),
  CONSTRAINT `acto_desemp_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `acto_desemp_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- 2) break_glass_grants (time-bound SoD bypass)
CREATE TABLE IF NOT EXISTS `break_glass_grants` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NULL,
  `capability` varchar(64) NOT NULL,
  `justificacion` text NOT NULL,
  `granted_by` bigint unsigned NOT NULL,
  `valid_from` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `valid_until` timestamp NOT NULL,
  `revoked_at` timestamp NULL,
  `revoked_by` bigint unsigned NULL,
  `expediente_event_id` bigint unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bg_tenant_id_uq` (`tenant_id`,`id`),
  KEY `bg_user_active_idx` (`tenant_id`,`user_id`,`valid_until`),
  KEY `bg_lic_idx` (`tenant_id`,`licitacion_id`),
  CONSTRAINT `bg_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `bg_user_fk` FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `bg_grantor_fk` FOREIGN KEY (`tenant_id`,`granted_by`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- 3) audit_chain_heads (serialize hash chain per tenant)
CREATE TABLE IF NOT EXISTS `audit_chain_heads` (
  `tenant_id` bigint unsigned NOT NULL,
  `last_event_hash` varchar(64) NULL,
  `last_audit_id` bigint unsigned NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`),
  CONSTRAINT `audit_heads_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- 4) outbox lease + idempotency
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'domain_outbox' AND COLUMN_NAME = 'claimed_at');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `domain_outbox` ADD COLUMN `claimed_at` timestamp NULL AFTER `status`, ADD COLUMN `claimed_by` varchar(80) NULL AFTER `claimed_at`, ADD COLUMN `idempotency_key` varchar(120) NULL AFTER `claimed_by`, ADD COLUMN `provider_message_id` varchar(200) NULL AFTER `last_error`', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'domain_outbox' AND INDEX_NAME = 'outbox_idem_uq');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `domain_outbox` ADD UNIQUE KEY `outbox_idem_uq` (`tenant_id`,`idempotency_key`)', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5) participaciones soft-delete states RETIRADA / INVALIDADA
-- MariaDB: modify enum (add values)
ALTER TABLE `participaciones`
  MODIFY COLUMN `estado_evaluacion` enum('PENDIENTE','EN_EVALUACION','ADMISIBLE','NO_ADMISIBLE','RECHAZADA','GANADORA','DESCARTADA','RETIRADA','INVALIDADA') NOT NULL DEFAULT 'PENDIENTE';

-- 6) capability break_glass (catalog is app-side; seed grant marker table already covers runtime)
-- Ensure system sentinel user can be created by ops; no hardcoded actor id=1 in workers.
