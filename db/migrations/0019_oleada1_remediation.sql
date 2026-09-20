-- 0019: Piedra Angular Oleada 1/2 remediation
-- - Soft-delete licitaciones (ELIMINADA + deleted_at)
-- - LAASSP art. 35 modality catalog (7 types; INVITACION_RESTRINGIDA kept as legacy alias)
-- - supplier_legal_entities (global RFC identity) + proveedores.legal_entity_id
-- - ProcedurePolicy seeds for new modalities (unsupported transitions refuse, not silent LP flow)

-- 1) Soft-delete licitaciones
ALTER TABLE `licitaciones`
  MODIFY COLUMN `estado` ENUM(
    'BORRADOR','CONSULTAS','PUBLICADA','EN_EVALUACION','ADJUDICADA',
    'DESIERTA','CANCELADA','FINALIZADA','ARCHIVADA','ELIMINADA'
  ) NOT NULL DEFAULT 'BORRADOR';

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'licitaciones' AND COLUMN_NAME = 'deleted_at');
SET @sqlstmt := IF(@exist = 0,
  'ALTER TABLE `licitaciones` ADD COLUMN `deleted_at` timestamp NULL DEFAULT NULL',
  'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Extend modality ENUMs (licitaciones.tipo_licitacion, procedure_policies, estrategias_contratacion)
ALTER TABLE `licitaciones`
  MODIFY COLUMN `tipo_licitacion` ENUM(
    'LICITACION_PUBLICA',
    'INVITACION_RESTRINGIDA',
    'INVITACION_TRES',
    'ADJUDICACION_DIRECTA',
    'DIALOGO_COMPETITIVO',
    'ADJUDICACION_DIRECTA_NEGOCIACION',
    'ACUERDO_MARCO_ASIGNACION',
    'TIENDA_DIGITAL_ORDEN'
  ) NOT NULL;

ALTER TABLE `procedure_policies`
  MODIFY COLUMN `modalidad` ENUM(
    'LICITACION_PUBLICA',
    'INVITACION_RESTRINGIDA',
    'INVITACION_TRES',
    'ADJUDICACION_DIRECTA',
    'DIALOGO_COMPETITIVO',
    'ADJUDICACION_DIRECTA_NEGOCIACION',
    'ACUERDO_MARCO_ASIGNACION',
    'TIENDA_DIGITAL_ORDEN'
  ) NOT NULL;

-- estrategias_contratacion may not exist on all envs — guard
SET @exist := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estrategias_contratacion');
SET @sqlstmt := IF(@exist > 0,
  "ALTER TABLE `estrategias_contratacion` MODIFY COLUMN `modalidad` ENUM(
    'LICITACION_PUBLICA','INVITACION_RESTRINGIDA','INVITACION_TRES','ADJUDICACION_DIRECTA',
    'DIALOGO_COMPETITIVO','ADJUDICACION_DIRECTA_NEGOCIACION','ACUERDO_MARCO_ASIGNACION','TIENDA_DIGITAL_ORDEN'
  ) NOT NULL",
  'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Optional policy metadata: Hacienda/Comité constraint flag (JSON already on requisitos)
-- Seed INVITACION_TRES as preferred twin of INVITACION_RESTRINGIDA + 4 constrained modalities.
INSERT IGNORE INTO `procedure_policies`
  (`id`, `regime_id`, `modalidad`, `criterio_evaluacion`, `modo_evaluacion`, `ponderacion_tecnica`, `ponderacion_economica`,
   `tie_break_policy`, `requisitos`, `actos_obligatorios`, `version`, `hash`, `publicada_at`)
VALUES
  (7, 1, 'INVITACION_TRES', 'MEJOR_RELACION_CALIDAD_PRECIO', 'HIBRIDA', 40.00, 60.00,
   JSON_ARRAY('precio', 'fechaRecepcion', 'sorteo_documentado'),
   JSON_OBJECT('ofertaTecnica', true, 'ofertaEconomica', true, 'garantiaSeriedad', false, 'aliasOf', 'INVITACION_RESTRINGIDA'),
   JSON_ARRAY('RECEPCION', 'APERTURA', 'EVALUACION', 'DICTAMEN', 'FALLO'),
   1, 'seed_laassp_it3_v1', CURRENT_TIMESTAMP),
  (8, 1, 'DIALOGO_COMPETITIVO', 'MEJOR_RELACION_CALIDAD_PRECIO', 'MANUAL', 50.00, 50.00,
   JSON_ARRAY('precio', 'sorteo_documentado'),
   JSON_OBJECT('ofertaTecnica', true, 'ofertaEconomica', true, 'constrainedBy', 'HACIENDA_COMITE', 'workflowSupported', false),
   JSON_ARRAY('RECEPCION', 'EVALUACION', 'DICTAMEN', 'FALLO'),
   1, 'seed_laassp_dc_v1', CURRENT_TIMESTAMP),
  (9, 1, 'ADJUDICACION_DIRECTA_NEGOCIACION', 'PRECIO_MAS_BAJO', 'MANUAL', 0.00, 100.00,
   JSON_ARRAY('precio', 'sorteo_documentado'),
   JSON_OBJECT('ofertaEconomica', true, 'constrainedBy', 'HACIENDA_COMITE', 'workflowSupported', false),
   JSON_ARRAY('EVALUACION', 'DICTAMEN', 'FALLO'),
   1, 'seed_laassp_adn_v1', CURRENT_TIMESTAMP),
  (10, 1, 'ACUERDO_MARCO_ASIGNACION', 'PRECIO_MAS_BAJO', 'MANUAL', 0.00, 100.00,
   JSON_ARRAY('precio'),
   JSON_OBJECT('ofertaEconomica', true, 'workflowSupported', false),
   JSON_ARRAY('EVALUACION', 'DICTAMEN', 'FALLO'),
   1, 'seed_laassp_ama_v1', CURRENT_TIMESTAMP),
  (11, 1, 'TIENDA_DIGITAL_ORDEN', 'PRECIO_MAS_BAJO', 'AUTOMATICA', 0.00, 100.00,
   JSON_ARRAY('precio'),
   JSON_OBJECT('ofertaEconomica', true, 'workflowSupported', false),
   JSON_ARRAY('EVALUACION', 'FALLO'),
   1, 'seed_laassp_tdo_v1', CURRENT_TIMESTAMP),
  (12, 2, 'INVITACION_TRES', 'MEJOR_RELACION_CALIDAD_PRECIO', 'HIBRIDA', 40.00, 60.00,
   JSON_ARRAY('precio', 'fechaRecepcion', 'sorteo_documentado'),
   JSON_OBJECT('ofertaTecnica', true, 'ofertaEconomica', true, 'garantiaSeriedad', true, 'aliasOf', 'INVITACION_RESTRINGIDA'),
   JSON_ARRAY('RECEPCION', 'APERTURA', 'EVALUACION', 'DICTAMEN', 'FALLO'),
   1, 'seed_lopsrm_it3_v1', CURRENT_TIMESTAMP);

-- 3) Global supplier legal identity (RFC unique nationally; tenant proveedor rows link here)
CREATE TABLE IF NOT EXISTS `supplier_legal_entities` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `rfc` varchar(13) NOT NULL,
  `razon_social` varchar(200) NOT NULL,
  `tipo_persona` enum('PERSONA_FISICA','PERSONA_MORAL','COOPERATIVA','CONSORCIO') NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sle_rfc_uq` (`rfc`),
  CONSTRAINT `sle_rfc_mx` CHECK (CHAR_LENGTH(`rfc`) IN (12, 13))
) ENGINE=InnoDB;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proveedores' AND COLUMN_NAME = 'legal_entity_id');
SET @sqlstmt := IF(@exist = 0,
  'ALTER TABLE `proveedores` ADD COLUMN `legal_entity_id` bigint unsigned NULL',
  'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'proveedores' AND INDEX_NAME = 'proveedores_legal_entity_idx');
SET @sqlstmt := IF(@exist = 0,
  'ALTER TABLE `proveedores` ADD KEY `proveedores_legal_entity_idx` (`legal_entity_id`)',
  'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'proveedores' AND CONSTRAINT_NAME = 'proveedores_legal_entity_fk');
SET @sqlstmt := IF(@exist = 0,
  'ALTER TABLE `proveedores` ADD CONSTRAINT `proveedores_legal_entity_fk` FOREIGN KEY (`legal_entity_id`) REFERENCES `supplier_legal_entities` (`id`) ON DELETE RESTRICT',
  'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill legal entities from distinct RFC (first razon_social wins)
INSERT INTO `supplier_legal_entities` (`rfc`, `razon_social`, `tipo_persona`)
SELECT p.rfc, MIN(p.razon_social), MIN(p.tipo_proveedor)
FROM `proveedores` p
WHERE NOT EXISTS (SELECT 1 FROM `supplier_legal_entities` s WHERE s.rfc = p.rfc)
GROUP BY p.rfc;

UPDATE `proveedores` p
INNER JOIN `supplier_legal_entities` s ON s.rfc = p.rfc
SET p.legal_entity_id = s.id
WHERE p.legal_entity_id IS NULL;
