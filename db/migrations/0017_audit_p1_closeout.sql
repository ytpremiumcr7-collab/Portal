-- 0017: Piedra Angular P1 audit close-out
-- calendar versions, hitos soft-cancel, login rate limit, firmas electronicas,
-- tenant SMTP settings, document mime detected, evidence FKs

-- 1) Calendar versioning (append-only history; live row remains current projection)
CREATE TABLE IF NOT EXISTS `calendario_versiones` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) unsigned NOT NULL,
  `calendario_acto_id` bigint(20) unsigned NOT NULL,
  `licitacion_id` bigint(20) unsigned NOT NULL,
  `acto` varchar(60) NOT NULL,
  `version` int NOT NULL,
  `ventana_inicio` timestamp NOT NULL,
  `ventana_fin` timestamp NOT NULL,
  `obligatorio` tinyint(1) NOT NULL DEFAULT 1,
  `motivo` varchar(500) NOT NULL,
  `changed_by` bigint(20) unsigned NOT NULL,
  `approved_by` bigint(20) unsigned NULL,
  `break_glass_id` bigint(20) unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `cal_ver_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `cal_ver_acto_ver_uq` (`tenant_id`,`calendario_acto_id`,`version`),
  KEY `cal_ver_lic_idx` (`tenant_id`,`licitacion_id`),
  CONSTRAINT `cal_ver_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) Hitos: ANULADO + motivo (no hard delete)
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hitos' AND COLUMN_NAME = 'motivo_anulacion');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `hitos` ADD COLUMN `motivo_anulacion` text NULL AFTER `cumplido`, ADD COLUMN `anulado_por` bigint(20) unsigned NULL AFTER `motivo_anulacion`, ADD COLUMN `anulado_at` timestamp NULL AFTER `anulado_por`', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Expand hitos.estado to include ANULADO (MariaDB: modify enum)
ALTER TABLE `hitos` MODIFY COLUMN `estado` enum('PENDIENTE','EN_PROGRESO','COMPLETADO','CANCELADO','RETRASADO','ANULADO') NOT NULL DEFAULT 'PENDIENTE';

-- 3) Evidence FKs on terminacion / desempate (idempotent)
SET @exist := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'actos_terminacion' AND CONSTRAINT_NAME = 'acto_term_doc_fk');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `actos_terminacion` ADD CONSTRAINT `acto_term_doc_fk` FOREIGN KEY (`tenant_id`, `documento_id`) REFERENCES `documentos` (`tenant_id`, `id`) ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'actos_desempate' AND CONSTRAINT_NAME = 'acto_desemp_doc_fk');
SET @sqlstmt := IF(@exist = 0,
  (SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'actos_desempate' AND COLUMN_NAME = 'evidencia_doc_id') > 0,
    'ALTER TABLE `actos_desempate` ADD CONSTRAINT `acto_desemp_doc_fk` FOREIGN KEY (`tenant_id`, `evidencia_doc_id`) REFERENCES `documentos` (`tenant_id`, `id`) ON DELETE RESTRICT',
    'SELECT 1'
  )),
  'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Document detected MIME (magic bytes)
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documentos' AND COLUMN_NAME = 'mime_detectado');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `documentos` ADD COLUMN `mime_detectado` varchar(120) NULL AFTER `mime_type`', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5) Login rate limit
CREATE TABLE IF NOT EXISTS `login_rate_limits` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `scope` enum('IP','ACCOUNT') NOT NULL,
  `scope_key` varchar(255) NOT NULL,
  `fail_count` int NOT NULL DEFAULT 0,
  `window_started_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `locked_until` timestamp NULL,
  `last_fail_at` timestamp NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `lrl_scope_key_uq` (`scope`,`scope_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6) Electronic signatures (honest labeling — SESSION_CONFIRMATION vs CRYPTO_SIGNATURE)
CREATE TABLE IF NOT EXISTS `firmas_electronicas` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) unsigned NOT NULL,
  `documento_id` bigint(20) unsigned NULL,
  `entidad_ref` varchar(64) NOT NULL,
  `entidad_id` bigint(20) unsigned NOT NULL,
  `kind` enum('SESSION_CONFIRMATION','CRYPTO_SIGNATURE') NOT NULL DEFAULT 'SESSION_CONFIRMATION',
  `document_digest` varchar(64) NOT NULL,
  `algorithm` varchar(64) NOT NULL DEFAULT 'SHA256',
  `signature_value` text NULL,
  `certificate_pem` text NULL,
  `signer_user_id` bigint(20) unsigned NOT NULL,
  `signed_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `validation_status` enum('PENDING','VALID','INVALID','NOT_APPLICABLE') NOT NULL DEFAULT 'NOT_APPLICABLE',
  `motivo` varchar(500) NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `firma_tenant_id_uq` (`tenant_id`,`id`),
  KEY `firma_entidad_idx` (`tenant_id`,`entidad_ref`,`entidad_id`),
  KEY `firma_doc_idx` (`tenant_id`,`documento_id`),
  CONSTRAINT `firma_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `firma_signer_fk` FOREIGN KEY (`tenant_id`, `signer_user_id`) REFERENCES `users` (`tenant_id`, `id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7) Tenant SMTP settings (UI-managed; secrets not stored in plain product tables beyond host/from)
CREATE TABLE IF NOT EXISTS `tenant_smtp_settings` (
  `tenant_id` bigint(20) unsigned NOT NULL,
  `host` varchar(255) NULL,
  `port` int NULL,
  `secure` tinyint(1) NOT NULL DEFAULT 0,
  `username` varchar(255) NULL,
  `from_address` varchar(255) NULL,
  `from_name` varchar(180) NULL,
  `status` enum('UNSET','CONFIGURED','DISABLED','ERROR') NOT NULL DEFAULT 'UNSET',
  `last_error` text NULL,
  `updated_by` bigint(20) unsigned NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`tenant_id`),
  CONSTRAINT `tenant_smtp_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
