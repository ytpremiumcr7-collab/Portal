-- Piedra Angular 0012: audit_log hash-chain + consorcios MVP
-- MySQL/MariaDB-valid. Idempotent where practical.

-- 1) audit_log hash chain (same spirit as expediente_events)
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_log' AND COLUMN_NAME = 'previous_hash');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `audit_log` ADD COLUMN `previous_hash` varchar(64) NULL AFTER `request_id`, ADD COLUMN `event_hash` varchar(64) NULL AFTER `previous_hash`', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Legacy rows keep event_hash NULL; new writeAudit rows always set the chain.

-- 2) Consorcios MVP
CREATE TABLE IF NOT EXISTS `consorcios` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `nombre` varchar(200) NOT NULL,
  `rfc_lider` varchar(13) NULL,
  `estado` enum('BORRADOR','ACTIVO','DISUELTO') NOT NULL DEFAULT 'BORRADOR',
  `creado_por` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `consorcio_tenant_id_uq` (`tenant_id`,`id`),
  KEY `consorcio_estado_idx` (`tenant_id`,`estado`),
  CONSTRAINT `consorcio_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `consorcio_actor_fk` FOREIGN KEY (`tenant_id`,`creado_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `consorcio_miembros` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `consorcio_id` bigint unsigned NOT NULL,
  `proveedor_id` bigint unsigned NOT NULL,
  `rol` enum('LIDER','MIEMBRO') NOT NULL DEFAULT 'MIEMBRO',
  `porcentaje_participacion` decimal(5,2) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cons_miembro_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `cons_miembro_prov_uq` (`tenant_id`,`consorcio_id`,`proveedor_id`),
  CONSTRAINT `cons_miembro_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `cons_miembro_cons_fk` FOREIGN KEY (`tenant_id`,`consorcio_id`) REFERENCES `consorcios` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `cons_miembro_prov_fk` FOREIGN KEY (`tenant_id`,`proveedor_id`) REFERENCES `proveedores` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Link participantes / proposiciones to consorcio
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'participaciones' AND COLUMN_NAME = 'consorcio_id');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `participaciones` ADD COLUMN `consorcio_id` bigint unsigned NULL', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'participaciones' AND CONSTRAINT_NAME = 'participaciones_consorcio_fk');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `participaciones` ADD CONSTRAINT `participaciones_consorcio_fk` FOREIGN KEY (`tenant_id`,`consorcio_id`) REFERENCES `consorcios` (`tenant_id`,`id`) ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proposiciones' AND COLUMN_NAME = 'consorcio_id');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `proposiciones` ADD COLUMN `consorcio_id` bigint unsigned NULL', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'proposiciones' AND CONSTRAINT_NAME = 'proposiciones_consorcio_fk');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `proposiciones` ADD CONSTRAINT `proposiciones_consorcio_fk` FOREIGN KEY (`tenant_id`,`consorcio_id`) REFERENCES `consorcios` (`tenant_id`,`id`) ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
