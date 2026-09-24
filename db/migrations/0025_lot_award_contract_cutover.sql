-- 0025: make lot decisions the legal source of awards and contracts.
-- Expand/backfill/contract ordering keeps existing GENERAL-lot records usable.

CREATE TABLE IF NOT EXISTS `fallo_lot_decisions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `fallo_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `lot_id` bigint unsigned NOT NULL,
  `outcome` enum('ADJUDICAR','DESIERTO','CANCELAR') NOT NULL,
  `participacion_id` bigint unsigned NULL,
  `proveedor_id` bigint unsigned NULL,
  `amount` decimal(18,2) NULL,
  `decision_currency` enum('MXN') NOT NULL DEFAULT 'MXN',
  `reason` text NOT NULL,
  `decided_by` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `fallo_lot_decision_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `fallo_lot_decision_uq` (`tenant_id`,`fallo_id`,`lot_id`),
  KEY `fallo_lot_decision_lic_idx` (`tenant_id`,`licitacion_id`,`outcome`),
  CONSTRAINT `fallo_lot_decision_shape_ck` CHECK (
    (`outcome`='ADJUDICAR' AND `participacion_id` IS NOT NULL AND `proveedor_id` IS NOT NULL AND `amount` IS NOT NULL AND `amount` >= 0)
    OR
    (`outcome` IN ('DESIERTO','CANCELAR') AND `participacion_id` IS NULL AND `proveedor_id` IS NULL AND `amount` IS NULL)
  )
) ENGINE=InnoDB;

-- Legacy fallos are represented on their canonical GENERAL lot.
INSERT IGNORE INTO `fallo_lot_decisions`
(`tenant_id`,`fallo_id`,`licitacion_id`,`lot_id`,`outcome`,`participacion_id`,`proveedor_id`,`amount`,`decision_currency`,`reason`,`decided_by`)
SELECT f.tenant_id,f.id,f.licitacion_id,l.id,f.sentido,p.id,f.proveedor_ganador_id,f.monto_adjudicado,'MXN',f.fundamento,
       COALESCE(f.emitido_por,f.aprobado_por,lic.convocante_id)
FROM `fallos` f
JOIN `licitaciones` lic ON lic.tenant_id=f.tenant_id AND lic.id=f.licitacion_id
JOIN `procedure_lots` l ON l.tenant_id=f.tenant_id AND l.licitacion_id=f.licitacion_id AND l.code='GENERAL'
JOIN `participaciones` p ON p.tenant_id=f.tenant_id AND p.lot_id=l.id AND p.proveedor_id=f.proveedor_ganador_id
WHERE f.sentido='ADJUDICAR' AND f.proveedor_ganador_id IS NOT NULL AND f.monto_adjudicado IS NOT NULL;

INSERT IGNORE INTO `fallo_lot_decisions`
(`tenant_id`,`fallo_id`,`licitacion_id`,`lot_id`,`outcome`,`participacion_id`,`proveedor_id`,`amount`,`decision_currency`,`reason`,`decided_by`)
SELECT f.tenant_id,f.id,f.licitacion_id,l.id,f.sentido,NULL,NULL,NULL,'MXN',f.fundamento,
       COALESCE(f.emitido_por,f.aprobado_por,lic.convocante_id)
FROM `fallos` f
JOIN `licitaciones` lic ON lic.tenant_id=f.tenant_id AND lic.id=f.licitacion_id
JOIN `procedure_lots` l ON l.tenant_id=f.tenant_id AND l.licitacion_id=f.licitacion_id AND l.code='GENERAL'
WHERE f.sentido IN ('DESIERTO','CANCELAR');

SET @column_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='awards' AND COLUMN_NAME='fallo_decision_id');
SET @sqlstmt := IF(@column_exists=0, 'ALTER TABLE `awards` ADD COLUMN `fallo_decision_id` bigint unsigned NULL AFTER `fallo_id`', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `awards` a
JOIN `fallo_lot_decisions` d
  ON d.tenant_id=a.tenant_id AND d.fallo_id=a.fallo_id AND d.lot_id=a.lot_id AND d.outcome='ADJUDICAR'
SET a.fallo_decision_id=d.id
WHERE a.fallo_decision_id IS NULL;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='awards' AND INDEX_NAME='award_fallo_decision_uq');
SET @sqlstmt := IF(@idx=0, 'ALTER TABLE `awards` ADD UNIQUE KEY `award_fallo_decision_uq` (`tenant_id`,`fallo_decision_id`)', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contratos' AND INDEX_NAME='contratos_tenant_lic_uq');
SET @sqlstmt := IF(@idx>0, 'ALTER TABLE `contratos` DROP INDEX `contratos_tenant_lic_uq`', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contratos' AND INDEX_NAME='contratos_tenant_award_uq');
SET @sqlstmt := IF(@idx=0, 'ALTER TABLE `contratos` ADD UNIQUE KEY `contratos_tenant_award_uq` (`tenant_id`,`award_id`)', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contratos' AND INDEX_NAME='contratos_licitacion_idx');
SET @sqlstmt := IF(@idx=0, 'ALTER TABLE `contratos` ADD KEY `contratos_licitacion_idx` (`tenant_id`,`licitacion_id`)', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE `fallo_lot_decisions`
  ADD CONSTRAINT `fallo_lot_decision_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fallo_lot_decision_fallo_fk` FOREIGN KEY (`tenant_id`,`fallo_id`) REFERENCES `fallos`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fallo_lot_decision_lot_fk` FOREIGN KEY (`tenant_id`,`lot_id`) REFERENCES `procedure_lots`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fallo_lot_decision_part_fk` FOREIGN KEY (`tenant_id`,`participacion_id`) REFERENCES `participaciones`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fallo_lot_decision_provider_fk` FOREIGN KEY (`tenant_id`,`proveedor_id`) REFERENCES `proveedores`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `fallo_lot_decision_actor_fk` FOREIGN KEY (`tenant_id`,`decided_by`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE RESTRICT;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='awards' AND CONSTRAINT_NAME='award_fallo_decision_fk');
SET @sqlstmt := IF(@fk=0, 'ALTER TABLE `awards` ADD CONSTRAINT `award_fallo_decision_fk` FOREIGN KEY (`tenant_id`,`fallo_decision_id`) REFERENCES `fallo_lot_decisions`(`tenant_id`,`id`) ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
