-- 0024: expand-first institutional e-procurement topology.
-- Adds canonical objects without removing legacy pointers/uniques yet.
-- Writer cutover and destructive contraction are intentionally deferred.

CREATE TABLE IF NOT EXISTS `organizational_units` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `entidad_id` bigint unsigned NOT NULL,
  `code` varchar(80) NOT NULL,
  `name` varchar(200) NOT NULL,
  `unit_type` enum('UNIDAD_COMPRADORA','AREA_REQUIRENTE','JURIDICO','PRESUPUESTO','CONTRATO','AUDITORIA') NOT NULL,
  `parent_unit_id` bigint unsigned NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` bigint unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `org_unit_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `org_unit_code_uq` (`tenant_id`,`entidad_id`,`code`),
  KEY `org_unit_entity_idx` (`tenant_id`,`entidad_id`,`active`),
  CONSTRAINT `org_unit_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `org_unit_entity_fk` FOREIGN KEY (`tenant_id`,`entidad_id`) REFERENCES `entidades`(`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `organizational_unit_memberships` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `unit_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `institutional_role` enum('OPERADOR','TECNICO','JURIDICO','PRESUPUESTO','APROBADOR','ADMIN_CONTRATO','AUDITOR') NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `valid_from` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `valid_until` timestamp NULL,
  `created_by` bigint unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `org_membership_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `org_membership_uq` (`tenant_id`,`unit_id`,`user_id`,`institutional_role`),
  KEY `org_membership_user_idx` (`tenant_id`,`user_id`,`active`),
  CONSTRAINT `org_membership_unit_fk` FOREIGN KEY (`tenant_id`,`unit_id`) REFERENCES `organizational_units`(`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `org_membership_user_fk` FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `authority_delegations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `unit_id` bigint unsigned NOT NULL,
  `delegator_user_id` bigint unsigned NOT NULL,
  `delegatee_user_id` bigint unsigned NOT NULL,
  `delegated_role` enum('OPERADOR','TECNICO','JURIDICO','PRESUPUESTO','APROBADOR','ADMIN_CONTRATO','AUDITOR') NOT NULL,
  `scope` json NULL,
  `reason` text NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `valid_from` timestamp NOT NULL,
  `valid_until` timestamp NOT NULL,
  `revoked_at` timestamp NULL,
  `revoked_by` bigint unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `authority_delegation_tenant_id_uq` (`tenant_id`,`id`),
  KEY `authority_delegatee_idx` (`tenant_id`,`delegatee_user_id`,`unit_id`,`active`),
  CONSTRAINT `authority_delegation_unit_fk` FOREIGN KEY (`tenant_id`,`unit_id`) REFERENCES `organizational_units`(`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `authority_delegator_fk` FOREIGN KEY (`tenant_id`,`delegator_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `authority_delegatee_fk` FOREIGN KEY (`tenant_id`,`delegatee_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `procedure_team_members` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `unit_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `institutional_role` varchar(40) NOT NULL,
  `procedure_role` varchar(64) NULL,
  `authority_source` enum('MEMBERSHIP','DELEGATION','MIGRATED_LEGACY') NOT NULL,
  `authority_ref_id` bigint unsigned NULL,
  `authority_snapshot` json NOT NULL,
  `captured_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `proc_team_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `proc_team_role_uq` (`tenant_id`,`licitacion_id`,`user_id`,`procedure_role`),
  KEY `proc_team_lic_idx` (`tenant_id`,`licitacion_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `supplier_memberships` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `proveedor_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `supplier_role` enum('OWNER','REPRESENTATIVE','PREPARER','SIGNER','ADMIN') NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `valid_from` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `valid_until` timestamp NULL,
  `created_by` bigint unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `supplier_membership_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `supplier_membership_uq` (`tenant_id`,`proveedor_id`,`user_id`,`supplier_role`),
  KEY `supplier_membership_user_idx` (`tenant_id`,`user_id`,`active`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `supplier_authorities` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `proveedor_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `authority_type` enum('LEGAL_REPRESENTATIVE','POWER_OF_ATTORNEY','SIGNATURE','PROCUREMENT') NOT NULL,
  `scope` json NULL,
  `document_id` bigint unsigned NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `valid_from` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `valid_until` timestamp NULL,
  `created_by` bigint unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `supplier_authority_tenant_id_uq` (`tenant_id`,`id`),
  KEY `supplier_authority_user_idx` (`tenant_id`,`proveedor_id`,`user_id`,`active`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `workflow_templates` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `code` varchar(80) NOT NULL,
  `version` int NOT NULL,
  `name` varchar(200) NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` bigint unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `workflow_template_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `workflow_template_code_version_uq` (`tenant_id`,`code`,`version`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `workflow_template_steps` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `template_id` bigint unsigned NOT NULL,
  `sequence` int NOT NULL,
  `action_code` varchar(80) NOT NULL,
  `title` varchar(200) NOT NULL,
  `required_role` varchar(40) NOT NULL,
  `completion_mode` enum('EXECUTE','REVIEW','APPROVE','SIGN') NOT NULL DEFAULT 'APPROVE',
  `due_hours` int NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `workflow_step_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `workflow_step_sequence_uq` (`tenant_id`,`template_id`,`sequence`),
  UNIQUE KEY `workflow_step_action_uq` (`tenant_id`,`template_id`,`action_code`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `workflow_instances` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `template_id` bigint unsigned NOT NULL,
  `template_version` int NOT NULL,
  `workflow_status` enum('RUNNING','COMPLETED','CANCELLED') NOT NULL DEFAULT 'RUNNING',
  `started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `workflow_instance_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `workflow_instance_lic_uq` (`tenant_id`,`licitacion_id`),
  KEY `workflow_instance_status_idx` (`tenant_id`,`workflow_status`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `work_tasks` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `workflow_instance_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `template_step_id` bigint unsigned NOT NULL,
  `sequence` int NOT NULL,
  `action_code` varchar(80) NOT NULL,
  `title` varchar(200) NOT NULL,
  `required_role` varchar(40) NOT NULL,
  `completion_mode` enum('EXECUTE','REVIEW','APPROVE','SIGN') NOT NULL,
  `task_state` enum('PENDIENTE','EN_PROGRESO','EN_REVISION','APROBADA','RECHAZADA','DEVUELTA','CANCELADA','VENCIDA') NOT NULL DEFAULT 'PENDIENTE',
  `assigned_unit_id` bigint unsigned NOT NULL,
  `assigned_user_id` bigint unsigned NULL,
  `due_at` timestamp NULL,
  `claimed_at` timestamp NULL,
  `completed_at` timestamp NULL,
  `created_by` bigint unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `work_task_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `work_task_instance_sequence_uq` (`tenant_id`,`workflow_instance_id`,`sequence`),
  KEY `work_task_inbox_idx` (`tenant_id`,`assigned_unit_id`,`task_state`,`due_at`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `task_approvals` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `task_id` bigint unsigned NOT NULL,
  `level` int NOT NULL DEFAULT 1,
  `approver_user_id` bigint unsigned NOT NULL,
  `authority_snapshot` json NOT NULL,
  `decision` enum('APPROVED','REJECTED','RETURNED') NOT NULL,
  `reason` text NOT NULL,
  `decided_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `task_approval_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `task_approval_once_uq` (`tenant_id`,`task_id`,`level`,`approver_user_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `procedure_lots` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `code` varchar(80) NOT NULL,
  `title` varchar(240) NOT NULL,
  `description` text NULL,
  `lot_status` enum('DRAFT','ACTIVE','CANCELLED','AWARDED','CLOSED') NOT NULL DEFAULT 'DRAFT',
  `estimated_amount` decimal(18,2) NULL,
  `currency` enum('MXN') NOT NULL DEFAULT 'MXN',
  `created_by` bigint unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `procedure_lot_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `procedure_lot_code_uq` (`tenant_id`,`licitacion_id`,`code`),
  KEY `procedure_lot_lic_idx` (`tenant_id`,`licitacion_id`,`lot_status`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `procedure_items` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `lot_id` bigint unsigned NOT NULL,
  `code` varchar(80) NOT NULL,
  `description` text NOT NULL,
  `quantity` decimal(18,4) NOT NULL,
  `unit` varchar(80) NOT NULL,
  `estimated_unit_price` decimal(18,2) NULL,
  `classification_code` varchar(80) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `procedure_item_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `procedure_item_code_uq` (`tenant_id`,`lot_id`,`code`),
  KEY `procedure_item_lot_idx` (`tenant_id`,`lot_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `awards` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `lot_id` bigint unsigned NOT NULL,
  `proveedor_id` bigint unsigned NOT NULL,
  `fallo_id` bigint unsigned NULL,
  `award_status` enum('DRAFT','APPROVED','PUBLISHED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `amount` decimal(18,2) NOT NULL,
  `currency` enum('MXN') NOT NULL DEFAULT 'MXN',
  `reason` text NOT NULL,
  `decided_by` bigint unsigned NOT NULL,
  `approved_by` bigint unsigned NULL,
  `approved_at` timestamp NULL,
  `published_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `award_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `award_lot_provider_uq` (`tenant_id`,`lot_id`,`proveedor_id`),
  KEY `award_lic_idx` (`tenant_id`,`licitacion_id`,`award_status`),
  KEY `award_lot_idx` (`tenant_id`,`lot_id`,`award_status`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `award_items` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `award_id` bigint unsigned NOT NULL,
  `item_id` bigint unsigned NOT NULL,
  `quantity` decimal(18,4) NOT NULL,
  `amount` decimal(18,2) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `award_item_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `award_item_uq` (`tenant_id`,`award_id`,`item_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `submission_receipts` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `lot_id` bigint unsigned NOT NULL,
  `participacion_id` bigint unsigned NOT NULL,
  `proposicion_id` bigint unsigned NOT NULL,
  `proveedor_id` bigint unsigned NOT NULL,
  `supplier_organization_id` bigint unsigned NOT NULL,
  `submitted_by_user_id` bigint unsigned NOT NULL,
  `supplier_membership_id` bigint unsigned NULL,
  `acting_authority_id` bigint unsigned NULL,
  `receipt_type` enum('SUBMISSION','WITHDRAWAL','REPLACEMENT') NOT NULL,
  `manifest_hash` char(64) NOT NULL,
  `submission_version` int NOT NULL DEFAULT 1,
  `supersedes_proposicion_id` bigint unsigned NULL,
  `server_received_at` timestamp NOT NULL,
  `receipt_hash` char(64) NOT NULL,
  `timestamp_status` enum('PENDING_EXTERNAL','ANCHORED','FAILED') NOT NULL DEFAULT 'PENDING_EXTERNAL',
  `timestamp_token` longblob NULL,
  `timestamped_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `submission_receipt_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `submission_receipt_hash_uq` (`receipt_hash`),
  KEY `submission_receipt_prop_idx` (`tenant_id`,`proposicion_id`,`receipt_type`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `publication_heads` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `last_release_no` int NOT NULL DEFAULT 0,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `publication_head_lic_uq` (`tenant_id`,`licitacion_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `publication_releases` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `release_no` int NOT NULL,
  `release_tag` varchar(100) NOT NULL,
  `event_type` varchar(100) NOT NULL,
  `source_type` varchar(80) NOT NULL,
  `source_id` bigint unsigned NOT NULL,
  `payload_hash` char(64) NOT NULL,
  `payload` json NOT NULL,
  `published_by` bigint unsigned NOT NULL,
  `published_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `supersedes_release_id` bigint unsigned NULL,
  `correction_reason` text NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `publication_release_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `publication_release_no_uq` (`tenant_id`,`licitacion_id`,`release_no`),
  UNIQUE KEY `publication_release_tag_uq` (`tenant_id`,`release_tag`),
  KEY `publication_release_event_idx` (`tenant_id`,`licitacion_id`,`event_type`)
) ENGINE=InnoDB;

-- Expand legacy aggregates idempotently.
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='licitaciones' AND COLUMN_NAME='contracting_unit_id');
SET @sqlstmt := IF(@exist=0, 'ALTER TABLE `licitaciones` ADD COLUMN `contracting_unit_id` bigint unsigned NULL AFTER `entidad_id`, ADD KEY `licitaciones_contracting_unit_idx` (`tenant_id`,`contracting_unit_id`)', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='participaciones' AND COLUMN_NAME='lot_id');
SET @sqlstmt := IF(@exist=0, 'ALTER TABLE `participaciones` ADD COLUMN `lot_id` bigint unsigned NULL AFTER `licitacion_id`, ADD KEY `participaciones_lot_idx` (`tenant_id`,`lot_id`)', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='proposiciones' AND COLUMN_NAME='lot_id');
SET @sqlstmt := IF(@exist=0, 'ALTER TABLE `proposiciones` ADD COLUMN `lot_id` bigint unsigned NULL AFTER `licitacion_id`, ADD KEY `prop_lot_idx` (`tenant_id`,`lot_id`)', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contratos' AND COLUMN_NAME='award_id');
SET @sqlstmt := IF(@exist=0, 'ALTER TABLE `contratos` ADD COLUMN `award_id` bigint unsigned NULL AFTER `fallo_id`, ADD KEY `contratos_award_idx` (`tenant_id`,`award_id`)', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill one explicit contracting unit per existing entidad.
INSERT IGNORE INTO `organizational_units` (`tenant_id`,`entidad_id`,`code`,`name`,`unit_type`,`active`)
SELECT e.tenant_id,e.id,'UC-GENERAL',CONCAT('Unidad compradora · ',e.razon_social),'UNIDAD_COMPRADORA',1
FROM `entidades` e;

UPDATE `licitaciones` l
JOIN `organizational_units` u
  ON u.tenant_id=l.tenant_id AND u.entidad_id=l.entidad_id AND u.code='UC-GENERAL'
SET l.contracting_unit_id=u.id
WHERE l.contracting_unit_id IS NULL;

-- Backfill current procedure actors as institutional memberships.
INSERT IGNORE INTO `organizational_unit_memberships`
(`tenant_id`,`unit_id`,`user_id`,`institutional_role`,`active`,`created_by`)
SELECT l.tenant_id,l.contracting_unit_id,l.convocante_id,'OPERADOR',1,l.convocante_id
FROM `licitaciones` l WHERE l.contracting_unit_id IS NOT NULL;

INSERT IGNORE INTO `organizational_unit_memberships`
(`tenant_id`,`unit_id`,`user_id`,`institutional_role`,`active`,`created_by`)
SELECT pa.tenant_id,l.contracting_unit_id,pa.user_id,
CASE pa.rol
 WHEN 'creador' THEN 'OPERADOR'
 WHEN 'evaluador_tecnico' THEN 'TECNICO'
 WHEN 'evaluador_economico' THEN 'TECNICO'
 WHEN 'dictaminador' THEN 'JURIDICO'
 WHEN 'autorizador_fallo' THEN 'APROBADOR'
 WHEN 'investigar_sancion' THEN 'JURIDICO'
 WHEN 'administrar_sancion' THEN 'APROBADOR'
 WHEN 'presentar_pago' THEN 'OPERADOR'
 WHEN 'aprobar_pago' THEN 'PRESUPUESTO'
 WHEN 'promovente' THEN 'OPERADOR'
 WHEN 'resolver_inconformidad' THEN 'JURIDICO'
 WHEN 'administrar_ejecucion' THEN 'ADMIN_CONTRATO'
 ELSE 'OPERADOR' END,
1,pa.asignado_por
FROM `procedimiento_asignaciones` pa
JOIN `licitaciones` l ON l.tenant_id=pa.tenant_id AND l.id=pa.licitacion_id
WHERE l.contracting_unit_id IS NOT NULL;

INSERT IGNORE INTO `procedure_team_members`
(`tenant_id`,`licitacion_id`,`unit_id`,`user_id`,`institutional_role`,`procedure_role`,`authority_source`,`authority_ref_id`,`authority_snapshot`)
SELECT pa.tenant_id,pa.licitacion_id,l.contracting_unit_id,pa.user_id,
CASE pa.rol
 WHEN 'creador' THEN 'OPERADOR'
 WHEN 'evaluador_tecnico' THEN 'TECNICO'
 WHEN 'evaluador_economico' THEN 'TECNICO'
 WHEN 'dictaminador' THEN 'JURIDICO'
 WHEN 'autorizador_fallo' THEN 'APROBADOR'
 WHEN 'aprobar_pago' THEN 'PRESUPUESTO'
 WHEN 'administrar_ejecucion' THEN 'ADMIN_CONTRATO'
 ELSE 'OPERADOR' END,
pa.rol,'MIGRATED_LEGACY',pa.id,
JSON_OBJECT('source','procedimiento_asignaciones','assignmentId',pa.id,'migration','0024')
FROM `procedimiento_asignaciones` pa
JOIN `licitaciones` l ON l.tenant_id=pa.tenant_id AND l.id=pa.licitacion_id
WHERE l.contracting_unit_id IS NOT NULL;

-- Backfill provider-owner pointers into real memberships.
INSERT IGNORE INTO `supplier_memberships`
(`tenant_id`,`proveedor_id`,`user_id`,`supplier_role`,`active`,`created_by`)
SELECT tenant_id,id,usuario_id,'OWNER',1,usuario_id
FROM `proveedores` WHERE usuario_id IS NOT NULL;

-- Explicit GENERAL lot preserves existing one-procedure offers during expand phase.
INSERT IGNORE INTO `procedure_lots`
(`tenant_id`,`licitacion_id`,`code`,`title`,`lot_status`,`estimated_amount`,`currency`,`created_by`)
SELECT tenant_id,id,'GENERAL','Lote general','ACTIVE',monto_presupuestado,'MXN',convocante_id
FROM `licitaciones`;

UPDATE `participaciones` p
JOIN `procedure_lots` l
  ON l.tenant_id=p.tenant_id AND l.licitacion_id=p.licitacion_id AND l.code='GENERAL'
SET p.lot_id=l.id WHERE p.lot_id IS NULL;

UPDATE `proposiciones` p
JOIN `procedure_lots` l
  ON l.tenant_id=p.tenant_id AND l.licitacion_id=p.licitacion_id AND l.code='GENERAL'
SET p.lot_id=l.id WHERE p.lot_id IS NULL;

-- Backfill current published/approved fallo as a first-class award, without yet removing winner pointers.
INSERT IGNORE INTO `awards`
(`tenant_id`,`licitacion_id`,`lot_id`,`proveedor_id`,`fallo_id`,`award_status`,`amount`,`currency`,`reason`,`decided_by`,`approved_by`,`approved_at`,`published_at`)
SELECT f.tenant_id,f.licitacion_id,l.id,f.proveedor_ganador_id,f.id,
CASE WHEN f.estado='PUBLICADO' THEN 'PUBLISHED' ELSE 'APPROVED' END,
f.monto_adjudicado,'MXN',f.fundamento,
COALESCE(f.emitido_por,f.aprobado_por,lic.convocante_id),
f.aprobado_por,f.aprobado_at,f.publicado_at
FROM `fallos` f
JOIN `licitaciones` lic ON lic.tenant_id=f.tenant_id AND lic.id=f.licitacion_id
JOIN `procedure_lots` l ON l.tenant_id=f.tenant_id AND l.licitacion_id=f.licitacion_id AND l.code='GENERAL'
WHERE f.sentido='ADJUDICAR'
  AND f.estado IN ('APROBADO','PUBLICADO')
  AND f.proveedor_ganador_id IS NOT NULL
  AND f.monto_adjudicado IS NOT NULL;

UPDATE `contratos` c
JOIN `awards` a
  ON a.tenant_id=c.tenant_id AND a.licitacion_id=c.licitacion_id AND a.proveedor_id=c.proveedor_id
SET c.award_id=a.id
WHERE c.award_id IS NULL;

-- Add foreign keys after backfill, conditionally.
SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='licitaciones' AND CONSTRAINT_NAME='licitaciones_contracting_unit_fk');
SET @sqlstmt := IF(@fk=0, 'ALTER TABLE `licitaciones` ADD CONSTRAINT `licitaciones_contracting_unit_fk` FOREIGN KEY (`tenant_id`,`contracting_unit_id`) REFERENCES `organizational_units`(`tenant_id`,`id`) ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='participaciones' AND CONSTRAINT_NAME='participaciones_lot_fk');
SET @sqlstmt := IF(@fk=0, 'ALTER TABLE `participaciones` ADD CONSTRAINT `participaciones_lot_fk` FOREIGN KEY (`tenant_id`,`lot_id`) REFERENCES `procedure_lots`(`tenant_id`,`id`) ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='proposiciones' AND CONSTRAINT_NAME='proposiciones_lot_fk');
SET @sqlstmt := IF(@fk=0, 'ALTER TABLE `proposiciones` ADD CONSTRAINT `proposiciones_lot_fk` FOREIGN KEY (`tenant_id`,`lot_id`) REFERENCES `procedure_lots`(`tenant_id`,`id`) ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='contratos' AND CONSTRAINT_NAME='contratos_award_fk');
SET @sqlstmt := IF(@fk=0, 'ALTER TABLE `contratos` ADD CONSTRAINT `contratos_award_fk` FOREIGN KEY (`tenant_id`,`award_id`) REFERENCES `awards`(`tenant_id`,`id`) ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Foreign keys for new tables are added here so CREATE remains dependency-order tolerant.
ALTER TABLE `procedure_team_members`
  ADD CONSTRAINT `proc_team_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `proc_team_unit_fk` FOREIGN KEY (`tenant_id`,`unit_id`) REFERENCES `organizational_units`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `proc_team_user_fk` FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE RESTRICT;

ALTER TABLE `supplier_memberships`
  ADD CONSTRAINT `supplier_membership_provider_fk` FOREIGN KEY (`tenant_id`,`proveedor_id`) REFERENCES `proveedores`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `supplier_membership_user_fk` FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE RESTRICT;

ALTER TABLE `supplier_authorities`
  ADD CONSTRAINT `supplier_authority_provider_fk` FOREIGN KEY (`tenant_id`,`proveedor_id`) REFERENCES `proveedores`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `supplier_authority_user_fk` FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `supplier_authority_doc_fk` FOREIGN KEY (`tenant_id`,`document_id`) REFERENCES `documentos`(`tenant_id`,`id`) ON DELETE RESTRICT;

ALTER TABLE `workflow_template_steps`
  ADD CONSTRAINT `workflow_step_template_fk` FOREIGN KEY (`tenant_id`,`template_id`) REFERENCES `workflow_templates`(`tenant_id`,`id`) ON DELETE RESTRICT;

ALTER TABLE `workflow_instances`
  ADD CONSTRAINT `workflow_instance_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `workflow_instance_template_fk` FOREIGN KEY (`tenant_id`,`template_id`) REFERENCES `workflow_templates`(`tenant_id`,`id`) ON DELETE RESTRICT;

ALTER TABLE `work_tasks`
  ADD CONSTRAINT `work_task_instance_fk` FOREIGN KEY (`tenant_id`,`workflow_instance_id`) REFERENCES `workflow_instances`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `work_task_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `work_task_unit_fk` FOREIGN KEY (`tenant_id`,`assigned_unit_id`) REFERENCES `organizational_units`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `work_task_user_fk` FOREIGN KEY (`tenant_id`,`assigned_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE RESTRICT;

ALTER TABLE `task_approvals`
  ADD CONSTRAINT `task_approval_task_fk` FOREIGN KEY (`tenant_id`,`task_id`) REFERENCES `work_tasks`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `task_approval_user_fk` FOREIGN KEY (`tenant_id`,`approver_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE RESTRICT;

ALTER TABLE `procedure_lots`
  ADD CONSTRAINT `procedure_lot_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones`(`tenant_id`,`id`) ON DELETE RESTRICT;

ALTER TABLE `procedure_items`
  ADD CONSTRAINT `procedure_item_lot_fk` FOREIGN KEY (`tenant_id`,`lot_id`) REFERENCES `procedure_lots`(`tenant_id`,`id`) ON DELETE RESTRICT;

ALTER TABLE `awards`
  ADD CONSTRAINT `award_lot_fk` FOREIGN KEY (`tenant_id`,`lot_id`) REFERENCES `procedure_lots`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `award_provider_fk` FOREIGN KEY (`tenant_id`,`proveedor_id`) REFERENCES `proveedores`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `award_fallo_fk` FOREIGN KEY (`tenant_id`,`fallo_id`) REFERENCES `fallos`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `award_decider_fk` FOREIGN KEY (`tenant_id`,`decided_by`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `award_approver_fk` FOREIGN KEY (`tenant_id`,`approved_by`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE RESTRICT;

ALTER TABLE `award_items`
  ADD CONSTRAINT `award_item_award_fk` FOREIGN KEY (`tenant_id`,`award_id`) REFERENCES `awards`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `award_item_item_fk` FOREIGN KEY (`tenant_id`,`item_id`) REFERENCES `procedure_items`(`tenant_id`,`id`) ON DELETE RESTRICT;

ALTER TABLE `submission_receipts`
  ADD CONSTRAINT `submission_receipt_lot_fk` FOREIGN KEY (`tenant_id`,`lot_id`) REFERENCES `procedure_lots`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `submission_receipt_part_fk` FOREIGN KEY (`tenant_id`,`participacion_id`) REFERENCES `participaciones`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `submission_receipt_prop_fk` FOREIGN KEY (`tenant_id`,`proposicion_id`) REFERENCES `proposiciones`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `submission_receipt_provider_fk` FOREIGN KEY (`tenant_id`,`proveedor_id`) REFERENCES `proveedores`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `submission_receipt_org_fk` FOREIGN KEY (`supplier_organization_id`) REFERENCES `supplier_legal_entities`(`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `submission_receipt_user_fk` FOREIGN KEY (`tenant_id`,`submitted_by_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE RESTRICT;

ALTER TABLE `publication_heads`
  ADD CONSTRAINT `publication_head_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones`(`tenant_id`,`id`) ON DELETE RESTRICT;

ALTER TABLE `publication_releases`
  ADD CONSTRAINT `publication_release_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones`(`tenant_id`,`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `publication_release_user_fk` FOREIGN KEY (`tenant_id`,`published_by`) REFERENCES `users`(`tenant_id`,`id`) ON DELETE RESTRICT;
