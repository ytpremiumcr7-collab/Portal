-- ARES 0007: freeze evaluation rules at publish + document evidence FKs.
-- MySQL-valid bigint unsigned (same style as 0004–0006). Idempotent.

-- ========== Frozen evaluation parameters (written on publish; eval/adjudicación MUST read these) ==========
CREATE TABLE IF NOT EXISTS `licitacion_reglas_version` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `criterio_evaluacion` varchar(40) NOT NULL,
  `ponderacion_tecnica` decimal(5,2) NOT NULL,
  `ponderacion_economica` decimal(5,2) NOT NULL,
  `modo_evaluacion` varchar(20) NOT NULL,
  `tipo_licitacion` varchar(40) NOT NULL,
  `tipo_contratacion` varchar(40) NOT NULL,
  `marco_juridico` varchar(20) NOT NULL,
  `rubrica_tecnica` text NULL,
  `reglas_hash` varchar(64) NOT NULL,
  `published_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `published_by` bigint unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `lic_reglas_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `lic_reglas_lic_ver_uq` (`tenant_id`,`licitacion_id`,`version`),
  KEY `lic_reglas_lic_idx` (`tenant_id`,`licitacion_id`),
  CONSTRAINT `lic_reglas_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `lic_reglas_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `lic_reglas_actor_fk` FOREIGN KEY (`tenant_id`,`published_by`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ========== Document evidence FKs (tenant-safe via documentos.tenant_id+id) — idempotent ==========
SET @exist := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'garantias' AND CONSTRAINT_NAME = 'garantias_documento_fk'
);
SET @sqlstmt := IF(@exist = 0,
  'ALTER TABLE `garantias` ADD CONSTRAINT `garantias_documento_fk` FOREIGN KEY (`tenant_id`,`documento_id`) REFERENCES `documentos` (`tenant_id`,`id`) ON DELETE RESTRICT',
  'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'contratos' AND CONSTRAINT_NAME = 'contratos_documento_fk'
);
SET @sqlstmt := IF(@exist = 0,
  'ALTER TABLE `contratos` ADD CONSTRAINT `contratos_documento_fk` FOREIGN KEY (`tenant_id`,`documento_contrato_id`) REFERENCES `documentos` (`tenant_id`,`id`) ON DELETE RESTRICT',
  'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'contratos' AND CONSTRAINT_NAME = 'contratos_documento_rescision_fk'
);
SET @sqlstmt := IF(@exist = 0,
  'ALTER TABLE `contratos` ADD CONSTRAINT `contratos_documento_rescision_fk` FOREIGN KEY (`tenant_id`,`documento_rescision_id`) REFERENCES `documentos` (`tenant_id`,`id`) ON DELETE RESTRICT',
  'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
