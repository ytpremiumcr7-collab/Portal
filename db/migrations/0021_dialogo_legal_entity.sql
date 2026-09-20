-- 0021: Diálogo competitivo MVP + proveedores.legal_entity_id NOT NULL

-- 1) dialogo_rondas — competitive dialogue / negotiation rounds
CREATE TABLE IF NOT EXISTS `dialogo_rondas` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `expediente_id` bigint unsigned NOT NULL,
  `ronda` int NOT NULL,
  `tema` varchar(240) NOT NULL,
  `participantes` json NULL,
  `notas` text NULL,
  `documento_id` bigint unsigned NULL,
  `estado` enum('ABIERTA','CERRADA') NOT NULL DEFAULT 'ABIERTA',
  `created_by` bigint unsigned NOT NULL,
  `cerrada_by` bigint unsigned NULL,
  `cerrada_at` timestamp NULL,
  `motivo_apertura` text NOT NULL,
  `motivo_cierre` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `dialogo_rondas_tenant_id_uq` (`tenant_id`, `id`),
  UNIQUE KEY `dialogo_rondas_lic_ronda_uq` (`tenant_id`, `licitacion_id`, `ronda`),
  KEY `dialogo_rondas_lic_estado_idx` (`tenant_id`, `licitacion_id`, `estado`),
  CONSTRAINT `dialogo_rondas_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `dialogo_rondas_lic_fk` FOREIGN KEY (`tenant_id`, `licitacion_id`) REFERENCES `licitaciones` (`tenant_id`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `dialogo_rondas_actor_fk` FOREIGN KEY (`tenant_id`, `created_by`) REFERENCES `users` (`tenant_id`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `dialogo_rondas_ronda_pos` CHECK (`ronda` > 0)
) ENGINE=InnoDB;

-- 2) Re-backfill proveedores.legal_entity_id from RFC (idempotent)
INSERT INTO `supplier_legal_entities` (`rfc`, `razon_social`, `tipo_persona`)
SELECT UPPER(REPLACE(p.rfc, ' ', '')), MIN(p.razon_social), MIN(p.tipo_proveedor)
FROM `proveedores` p
WHERE p.rfc IS NOT NULL AND CHAR_LENGTH(REPLACE(p.rfc, ' ', '')) IN (12, 13)
  AND p.legal_entity_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `supplier_legal_entities` s
    WHERE s.rfc = UPPER(REPLACE(p.rfc, ' ', ''))
  )
GROUP BY UPPER(REPLACE(p.rfc, ' ', ''));

UPDATE `proveedores` p
INNER JOIN `supplier_legal_entities` s ON s.rfc = UPPER(REPLACE(p.rfc, ' ', ''))
SET p.legal_entity_id = s.id
WHERE p.legal_entity_id IS NULL;

-- Fail loudly if any row remains without legal_entity_id (run data fix, then re-migrate)
-- MySQL has no RAISE; use a SIGNAL via a guaranteed-fail INSERT when orphans exist.
SET @orphans := (SELECT COUNT(*) FROM `proveedores` WHERE `legal_entity_id` IS NULL);
SET @sqlfail := IF(@orphans > 0,
  CONCAT('SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''0021: ', @orphans, ' proveedores still NULL legal_entity_id — fix RFC/razon_social then re-run'''),
  'SELECT 1');
-- SIGNAL via prepared statement is awkward; use a check table insert that violates NOT NULL when orphans > 0
CREATE TEMPORARY TABLE IF NOT EXISTS `_pa_le_orphan_gate` (`ok` tinyint NOT NULL);
DELETE FROM `_pa_le_orphan_gate`;
SET @gate := IF(@orphans > 0, NULL, 1);
INSERT INTO `_pa_le_orphan_gate` (`ok`) VALUES (@gate);
DROP TEMPORARY TABLE IF EXISTS `_pa_le_orphan_gate`;

-- Enforce NOT NULL + keep FK
SET @nullable := (
  SELECT IS_NULLABLE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proveedores' AND COLUMN_NAME = 'legal_entity_id'
);
SET @sqlstmt := IF(@nullable = 'YES',
  'ALTER TABLE `proveedores` MODIFY COLUMN `legal_entity_id` bigint unsigned NOT NULL',
  'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Ensure FK exists (idempotent)
SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'proveedores' AND CONSTRAINT_NAME = 'proveedores_legal_entity_fk'
);
SET @sqlstmt := IF(@fk = 0,
  'ALTER TABLE `proveedores` ADD CONSTRAINT `proveedores_legal_entity_fk` FOREIGN KEY (`legal_entity_id`) REFERENCES `supplier_legal_entities` (`id`) ON DELETE RESTRICT',
  'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Policy note: diálogo MVP uses dialogo_rondas (no longer deferred)
UPDATE `procedure_policies`
SET `requisitos` = JSON_SET(
  COALESCE(`requisitos`, JSON_OBJECT()),
  '$.workflowMvp', 'dialogo_rondas',
  '$.dialogoRondasTable', 'dialogo_rondas'
)
WHERE `modalidad` = 'DIALOGO_COMPETITIVO';
