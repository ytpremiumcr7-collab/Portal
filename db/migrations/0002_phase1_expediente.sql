CREATE TABLE `expedientes` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `folio` varchar(80) NOT NULL,
  `marco_juridico` enum('LAASSP','LOPSRM') NOT NULL,
  `estado` enum('INTEGRACION','REVISION_JURIDICA','APROBADO','OBSERVADO','CERRADO','ARCHIVADO') NOT NULL DEFAULT 'INTEGRACION',
  `version` int NOT NULL DEFAULT 1,
  `event_sequence` int NOT NULL DEFAULT 0,
  `iniciado_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cerrado_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `expedientes_tenant_licitacion_uq` (`tenant_id`,`licitacion_id`),
  UNIQUE KEY `expedientes_tenant_folio_uq` (`tenant_id`,`folio`),
  UNIQUE KEY `expedientes_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `expedientes_tenant_aggregate_uq` (`tenant_id`,`id`,`licitacion_id`),
  KEY `expedientes_tenant_estado_idx` (`tenant_id`,`estado`),
  CONSTRAINT `expedientes_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `expedientes_tenant_licitacion_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `expediente_version_positive` CHECK (`version` > 0 AND `event_sequence` >= 0)
) ENGINE=InnoDB;

CREATE TABLE `expediente_requirements` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `expediente_id` bigint unsigned NOT NULL,
  `codigo` varchar(80) NOT NULL,
  `nombre` varchar(180) NOT NULL,
  `tipo_documento` varchar(60) NOT NULL,
  `requerido` tinyint(1) NOT NULL DEFAULT 1,
  `estado` enum('PENDIENTE','CUMPLIDO','OBSERVADO','NO_APLICA') NOT NULL DEFAULT 'PENDIENTE',
  `documento_actual_id` bigint unsigned NULL,
  `observaciones` text NULL,
  `validado_por` bigint unsigned NULL,
  `validado_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `exp_req_tenant_code_uq` (`tenant_id`,`expediente_id`,`codigo`),
  KEY `exp_req_tenant_status_idx` (`tenant_id`,`expediente_id`,`estado`),
  CONSTRAINT `exp_req_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `exp_req_tenant_expediente_fk` FOREIGN KEY (`tenant_id`,`expediente_id`) REFERENCES `expedientes` (`tenant_id`,`id`) ON DELETE CASCADE,
  CONSTRAINT `exp_req_tenant_validator_fk` FOREIGN KEY (`tenant_id`,`validado_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE `expediente_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `expediente_id` bigint unsigned NOT NULL,
  `secuencia` int NOT NULL,
  `tipo` varchar(80) NOT NULL,
  `estado_anterior` varchar(40) NULL,
  `estado_nuevo` varchar(40) NULL,
  `actor_user_id` bigint unsigned NOT NULL,
  `motivo` text NULL,
  `payload` text NULL,
  `timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ip_address` varchar(64) NULL,
  `request_id` varchar(80) NULL,
  `previous_hash` varchar(64) NULL,
  `event_hash` varchar(64) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `exp_event_tenant_seq_uq` (`tenant_id`,`expediente_id`,`secuencia`),
  KEY `exp_event_tenant_time_idx` (`tenant_id`,`expediente_id`,`timestamp`),
  CONSTRAINT `exp_event_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `exp_event_tenant_expediente_fk` FOREIGN KEY (`tenant_id`,`expediente_id`) REFERENCES `expedientes` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `exp_event_tenant_actor_fk` FOREIGN KEY (`tenant_id`,`actor_user_id`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;


ALTER TABLE `documentos` MODIFY COLUMN `tipo` enum('CONVOCATORIA','FUNDAMENTO_JURIDICO','PLIEGO_TECNICO','PLIEGO_ADMINISTRATIVO','JUNTA_ACLARACIONES','ACTA_APERTURA','OFERTA_TECNICA','OFERTA_ECONOMICA','GARANTIA','ACTA_EVALUACION','DICTAMEN','FALLO_ADJUDICACION','CONTRATO','FACTURA','OTRO') NOT NULL;

ALTER TABLE `documentos`
  ADD COLUMN `expediente_id` bigint unsigned NULL AFTER `tenant_id`,
  ADD COLUMN `version_group` varchar(36) NULL AFTER `version`,
  ADD COLUMN `previous_version_id` bigint unsigned NULL AFTER `version_group`,
  ADD COLUMN `es_version_vigente` tinyint(1) NOT NULL DEFAULT 1 AFTER `previous_version_id`;

UPDATE `documentos` d
LEFT JOIN `licitaciones` l ON l.`tenant_id`=d.`tenant_id` AND l.`id`=d.`licitacion_id`
SET d.`expediente_id`=NULL
WHERE d.`licitacion_id` IS NULL;

INSERT INTO `expedientes` (`tenant_id`,`licitacion_id`,`folio`,`marco_juridico`,`estado`,`version`)
SELECT l.`tenant_id`, l.`id`, CONCAT('EXP-', l.`codigo`), CASE WHEN l.`tipo_contratacion`='OBRA' THEN 'LOPSRM' ELSE 'LAASSP' END, 'INTEGRACION', 1
FROM `licitaciones` l
LEFT JOIN `expedientes` e ON e.`tenant_id`=l.`tenant_id` AND e.`licitacion_id`=l.`id`
WHERE e.`id` IS NULL;

UPDATE `documentos` d
JOIN `expedientes` e ON e.`tenant_id`=d.`tenant_id` AND e.`licitacion_id`=d.`licitacion_id`
SET d.`expediente_id`=e.`id`
WHERE d.`licitacion_id` IS NOT NULL;

UPDATE `documentos` SET `version_group`=UUID() WHERE `version_group` IS NULL OR `version_group`='';
ALTER TABLE `documentos` MODIFY COLUMN `version_group` varchar(36) NOT NULL;

ALTER TABLE `hitos` ADD COLUMN `expediente_id` bigint unsigned NULL AFTER `tenant_id`;
UPDATE `hitos` h
JOIN `expedientes` e ON e.`tenant_id`=h.`tenant_id` AND e.`licitacion_id`=h.`licitacion_id`
SET h.`expediente_id`=e.`id`;

INSERT INTO `expediente_requirements` (`tenant_id`,`expediente_id`,`codigo`,`nombre`,`tipo_documento`,`requerido`,`estado`)
SELECT e.`tenant_id`, e.`id`, r.`codigo`, r.`nombre`, r.`tipo_documento`, 1, 'PENDIENTE'
FROM `expedientes` e
JOIN (
  SELECT 'CONVOCATORIA' codigo, 'Convocatoria o instrumento equivalente' nombre, 'CONVOCATORIA' tipo_documento
  UNION ALL SELECT 'FUNDAMENTO_JURIDICO','Fundamento / dictamen jurídico de procedencia','FUNDAMENTO_JURIDICO'
  UNION ALL SELECT 'PLIEGO_TECNICO','Documentación técnica / especificaciones','PLIEGO_TECNICO'
  UNION ALL SELECT 'PLIEGO_ADMINISTRATIVO','Documentación administrativa','PLIEGO_ADMINISTRATIVO'
  UNION ALL SELECT 'JUNTA_ACLARACIONES','Acta de junta de aclaraciones o constancia de no celebración','JUNTA_ACLARACIONES'
) r ON 1=1
LEFT JOIN `expediente_requirements` er ON er.`tenant_id`=e.`tenant_id` AND er.`expediente_id`=e.`id` AND er.`codigo`=r.`codigo`
WHERE er.`id` IS NULL;

ALTER TABLE `documentos`
  ADD UNIQUE KEY `documentos_tenant_id_uq` (`tenant_id`,`id`),
  ADD UNIQUE KEY `documentos_tenant_expediente_id_uq` (`tenant_id`,`expediente_id`,`id`),
  ADD UNIQUE KEY `documentos_tenant_version_uq` (`tenant_id`,`version_group`,`version`),
  ADD KEY `documentos_tenant_expediente_idx` (`tenant_id`,`expediente_id`);

ALTER TABLE `expediente_requirements`
  ADD CONSTRAINT `exp_req_tenant_document_fk` FOREIGN KEY (`tenant_id`,`expediente_id`,`documento_actual_id`) REFERENCES `documentos` (`tenant_id`,`expediente_id`,`id`) ON DELETE RESTRICT;

ALTER TABLE `documentos`
  ADD CONSTRAINT `documentos_tenant_expediente_fk` FOREIGN KEY (`tenant_id`,`expediente_id`,`licitacion_id`) REFERENCES `expedientes` (`tenant_id`,`id`,`licitacion_id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `documentos_tenant_previous_version_fk` FOREIGN KEY (`tenant_id`,`expediente_id`,`previous_version_id`) REFERENCES `documentos` (`tenant_id`,`expediente_id`,`id`) ON DELETE RESTRICT;

ALTER TABLE `hitos`
  MODIFY COLUMN `expediente_id` bigint unsigned NOT NULL,
  ADD CONSTRAINT `hitos_tenant_expediente_fk` FOREIGN KEY (`tenant_id`,`expediente_id`,`licitacion_id`) REFERENCES `expedientes` (`tenant_id`,`id`,`licitacion_id`) ON DELETE CASCADE,
  ADD KEY `hitos_tenant_expediente_idx` (`tenant_id`,`expediente_id`,`fecha_programada`);

-- Seed the evidence chain from existing audit-independent state is intentionally not fabricated.
-- New state transitions append tamper-evident events from application code.
