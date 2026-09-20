-- 0020: Oleada 2 residuals — FIEL metadata, modality meta, legal entity hardening

-- 1) firmas_electronicas: CRYPTO evidence columns
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'firmas_electronicas' AND COLUMN_NAME = 'cert_serial');
SET @sqlstmt := IF(@exist = 0,
  'ALTER TABLE `firmas_electronicas` ADD COLUMN `cert_serial` varchar(64) NULL AFTER `certificate_pem`',
  'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'firmas_electronicas' AND COLUMN_NAME = 'signer_rfc');
SET @sqlstmt := IF(@exist = 0,
  'ALTER TABLE `firmas_electronicas` ADD COLUMN `signer_rfc` varchar(13) NULL AFTER `cert_serial`',
  'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'firmas_electronicas' AND COLUMN_NAME = 'ocsp_evidence');
SET @sqlstmt := IF(@exist = 0,
  'ALTER TABLE `firmas_electronicas` ADD COLUMN `ocsp_evidence` text NULL AFTER `signer_rfc`',
  'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) licitaciones.modalidad_meta — gate fields for modalities 4–7 (JSON)
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'licitaciones' AND COLUMN_NAME = 'modalidad_meta');
SET @sqlstmt := IF(@exist = 0,
  'ALTER TABLE `licitaciones` ADD COLUMN `modalidad_meta` json NULL',
  'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) Ensure supplier_legal_entities exists (idempotent if 0019 already applied)
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

-- Backfill any proveedores still missing legal_entity_id
INSERT INTO `supplier_legal_entities` (`rfc`, `razon_social`, `tipo_persona`)
SELECT UPPER(REPLACE(p.rfc, ' ', '')), MIN(p.razon_social), MIN(p.tipo_proveedor)
FROM `proveedores` p
WHERE p.rfc IS NOT NULL AND CHAR_LENGTH(REPLACE(p.rfc, ' ', '')) IN (12, 13)
  AND NOT EXISTS (
    SELECT 1 FROM `supplier_legal_entities` s
    WHERE s.rfc = UPPER(REPLACE(p.rfc, ' ', ''))
  )
GROUP BY UPPER(REPLACE(p.rfc, ' ', ''));

UPDATE `proveedores` p
INNER JOIN `supplier_legal_entities` s ON s.rfc = UPPER(REPLACE(p.rfc, ' ', ''))
SET p.legal_entity_id = s.id, p.rfc = UPPER(REPLACE(p.rfc, ' ', ''))
WHERE p.legal_entity_id IS NULL;

-- Normalize legal entity RFCs
UPDATE `supplier_legal_entities`
SET `rfc` = UPPER(REPLACE(`rfc`, ' ', ''))
WHERE `rfc` <> UPPER(REPLACE(`rfc`, ' ', ''));

-- 4) Update modality policy seeds: still gated by auth metadata, not silent LP
-- Keep workflowSupported false in catalog; publish uses assertModalidadPublishable on merged meta.
UPDATE `procedure_policies`
SET `requisitos` = JSON_SET(
  COALESCE(`requisitos`, JSON_OBJECT()),
  '$.constrainedBy', 'HACIENDA_COMITE',
  '$.requiresAuthMeta', true,
  '$.workflowMvp', 'gated'
)
WHERE `modalidad` IN ('DIALOGO_COMPETITIVO', 'ADJUDICACION_DIRECTA_NEGOCIACION');

UPDATE `procedure_policies`
SET `requisitos` = JSON_SET(
  COALESCE(`requisitos`, JSON_OBJECT()),
  '$.requiresAcuerdoMarcoRef', true,
  '$.workflowMvp', 'gated',
  '$.skipConvocatoriaPublica', true
)
WHERE `modalidad` = 'ACUERDO_MARCO_ASIGNACION';

UPDATE `procedure_policies`
SET `requisitos` = JSON_SET(
  COALESCE(`requisitos`, JSON_OBJECT()),
  '$.requiresTiendaOrdenRef', true,
  '$.workflowMvp', 'gated',
  '$.refuseFullLpPresentacion', true
)
WHERE `modalidad` = 'TIENDA_DIGITAL_ORDEN';
