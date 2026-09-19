-- ARES 0008: LegalRegime + ProcedurePolicy + link to licitaciones / reglas freeze.
-- MySQL-valid. Idempotent where practical.

CREATE TABLE IF NOT EXISTS `legal_regimes` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(40) NOT NULL,
  `nombre` varchar(160) NOT NULL,
  `jurisdiccion` varchar(80) NOT NULL DEFAULT 'MX-FEDERAL',
  `activa` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `legal_regimes_code_uq` (`code`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `procedure_policies` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `regime_id` bigint unsigned NOT NULL,
  `modalidad` enum('LICITACION_PUBLICA','INVITACION_RESTRINGIDA','ADJUDICACION_DIRECTA') NOT NULL,
  `criterio_evaluacion` varchar(40) NOT NULL,
  `modo_evaluacion` varchar(20) NOT NULL DEFAULT 'HIBRIDA',
  `ponderacion_tecnica` decimal(5,2) NOT NULL DEFAULT 40.00,
  `ponderacion_economica` decimal(5,2) NOT NULL DEFAULT 60.00,
  `tie_break_policy` json NOT NULL,
  `requisitos` json NOT NULL,
  `actos_obligatorios` json NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `hash` varchar(64) NOT NULL,
  `publicada_at` timestamp NULL DEFAULT NULL,
  `created_by` bigint unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `proc_pol_regime_mod_ver_uq` (`regime_id`,`modalidad`,`version`),
  KEY `proc_pol_regime_idx` (`regime_id`),
  CONSTRAINT `proc_pol_regime_fk` FOREIGN KEY (`regime_id`) REFERENCES `legal_regimes` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Link columns on licitaciones (idempotent)
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'licitaciones' AND COLUMN_NAME = 'policy_id');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `licitaciones` ADD COLUMN `policy_id` bigint unsigned NULL', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'licitaciones' AND COLUMN_NAME = 'policy_version_id');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `licitaciones` ADD COLUMN `policy_version_id` bigint unsigned NULL', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'licitaciones' AND CONSTRAINT_NAME = 'licitaciones_policy_fk');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `licitaciones` ADD CONSTRAINT `licitaciones_policy_fk` FOREIGN KEY (`policy_id`) REFERENCES `procedure_policies` (`id`) ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'licitaciones' AND CONSTRAINT_NAME = 'licitaciones_policy_version_fk');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `licitaciones` ADD CONSTRAINT `licitaciones_policy_version_fk` FOREIGN KEY (`policy_version_id`) REFERENCES `procedure_policies` (`id`) ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Extend frozen reglas snapshot with policy fields
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'licitacion_reglas_version' AND COLUMN_NAME = 'policy_id');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `licitacion_reglas_version` ADD COLUMN `policy_id` bigint unsigned NULL, ADD COLUMN `policy_hash` varchar(64) NULL, ADD COLUMN `tie_break_policy` json NULL, ADD COLUMN `actos_obligatorios` json NULL, ADD COLUMN `requisitos` json NULL', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Seed regimes
INSERT IGNORE INTO `legal_regimes` (`id`, `code`, `nombre`, `jurisdiccion`, `activa`) VALUES
  (1, 'LAASSP', 'Ley de Adquisiciones, Arrendamientos y Servicios del Sector Público', 'MX-FEDERAL', 1),
  (2, 'LOPSRM', 'Ley de Obras Públicas y Servicios Relacionados con las Mismas', 'MX-FEDERAL', 1);

-- Seed default policies (hash placeholders updated by app; stable seed hashes)
INSERT IGNORE INTO `procedure_policies`
  (`id`, `regime_id`, `modalidad`, `criterio_evaluacion`, `modo_evaluacion`, `ponderacion_tecnica`, `ponderacion_economica`,
   `tie_break_policy`, `requisitos`, `actos_obligatorios`, `version`, `hash`, `publicada_at`)
VALUES
  (1, 1, 'LICITACION_PUBLICA', 'MEJOR_RELACION_CALIDAD_PRECIO', 'HIBRIDA', 40.00, 60.00,
   JSON_ARRAY('precio', 'fechaRecepcion', 'sorteo_documentado'),
   JSON_OBJECT('ofertaTecnica', true, 'ofertaEconomica', true, 'garantiaSeriedad', false),
   JSON_ARRAY('JUNTA_ACLARACIONES', 'RECEPCION', 'APERTURA', 'EVALUACION', 'DICTAMEN', 'FALLO'),
   1, 'seed_laassp_lp_v1', CURRENT_TIMESTAMP),
  (2, 1, 'INVITACION_RESTRINGIDA', 'MEJOR_RELACION_CALIDAD_PRECIO', 'HIBRIDA', 40.00, 60.00,
   JSON_ARRAY('precio', 'fechaRecepcion', 'sorteo_documentado'),
   JSON_OBJECT('ofertaTecnica', true, 'ofertaEconomica', true, 'garantiaSeriedad', false),
   JSON_ARRAY('RECEPCION', 'APERTURA', 'EVALUACION', 'DICTAMEN', 'FALLO'),
   1, 'seed_laassp_ir_v1', CURRENT_TIMESTAMP),
  (3, 1, 'ADJUDICACION_DIRECTA', 'PRECIO_MAS_BAJO', 'MANUAL', 0.00, 100.00,
   JSON_ARRAY('precio', 'sorteo_documentado'),
   JSON_OBJECT('ofertaTecnica', false, 'ofertaEconomica', true, 'garantiaSeriedad', false),
   JSON_ARRAY('EVALUACION', 'DICTAMEN', 'FALLO'),
   1, 'seed_laassp_ad_v1', CURRENT_TIMESTAMP),
  (4, 2, 'LICITACION_PUBLICA', 'MEJOR_RELACION_CALIDAD_PRECIO', 'HIBRIDA', 40.00, 60.00,
   JSON_ARRAY('precio', 'fechaRecepcion', 'sorteo_documentado'),
   JSON_OBJECT('ofertaTecnica', true, 'ofertaEconomica', true, 'garantiaSeriedad', true),
   JSON_ARRAY('JUNTA_ACLARACIONES', 'RECEPCION', 'APERTURA', 'EVALUACION', 'DICTAMEN', 'FALLO'),
   1, 'seed_lopsrm_lp_v1', CURRENT_TIMESTAMP),
  (5, 2, 'INVITACION_RESTRINGIDA', 'MEJOR_RELACION_CALIDAD_PRECIO', 'HIBRIDA', 40.00, 60.00,
   JSON_ARRAY('precio', 'fechaRecepcion', 'sorteo_documentado'),
   JSON_OBJECT('ofertaTecnica', true, 'ofertaEconomica', true, 'garantiaSeriedad', true),
   JSON_ARRAY('RECEPCION', 'APERTURA', 'EVALUACION', 'DICTAMEN', 'FALLO'),
   1, 'seed_lopsrm_ir_v1', CURRENT_TIMESTAMP),
  (6, 2, 'ADJUDICACION_DIRECTA', 'PRECIO_MAS_BAJO', 'MANUAL', 0.00, 100.00,
   JSON_ARRAY('precio', 'sorteo_documentado'),
   JSON_OBJECT('ofertaTecnica', false, 'ofertaEconomica', true, 'garantiaSeriedad', false),
   JSON_ARRAY('EVALUACION', 'DICTAMEN', 'FALLO'),
   1, 'seed_lopsrm_ad_v1', CURRENT_TIMESTAMP);
