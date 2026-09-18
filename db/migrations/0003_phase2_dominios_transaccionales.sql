-- ARES Phase 2: dominios transaccionales reales (aclaraciones, apertura, dictamen, fallo, contratos, garantías)
-- Conserva expediente gobernado. Soft-delete de tenant + RESTRICT en tablas de evidencia.

ALTER TABLE `tenants`
  ADD COLUMN `deleted_at` timestamp NULL DEFAULT NULL AFTER `activa`;

-- Evidencia durable: impedir CASCADE que borre cadena al eliminar tenant
ALTER TABLE `expediente_events` DROP FOREIGN KEY `exp_event_tenant_fk`;
ALTER TABLE `expediente_events`
  ADD CONSTRAINT `exp_event_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT;

ALTER TABLE `audit_log` DROP FOREIGN KEY `audit_tenant_fk`;
ALTER TABLE `audit_log`
  ADD CONSTRAINT `audit_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT;

ALTER TABLE `expedientes` DROP FOREIGN KEY `expedientes_tenant_fk`;
ALTER TABLE `expedientes`
  ADD CONSTRAINT `expedientes_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT;

-- Etapas intermedias post-evaluación
ALTER TABLE `licitaciones`
  MODIFY COLUMN `etapa` enum(
    'PREPARACION','JUNTA_ACLARACIONES','CONVOCATORIA','PRESENTACION','EVALUACION',
    'DICTAMEN','FALLO','ADJUDICACION','CONTRATACION','EJECUCION','FINALIZACION'
  ) NOT NULL DEFAULT 'PREPARACION';

-- ========== ACLARACIONES ==========
CREATE TABLE `aclaraciones_juntas` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `expediente_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `nombre` varchar(180) NOT NULL,
  `modalidad` enum('PRESENCIAL','VIRTUAL','MIXTA') NOT NULL DEFAULT 'VIRTUAL',
  `fecha_programada` timestamp NOT NULL,
  `fecha_limite_preguntas` timestamp NOT NULL,
  `estado` enum('PROGRAMADA','ABIERTA','CERRADA_PREGUNTAS','EN_RESPUESTA','ACTA_EMITIDA','PUBLICADA','CANCELADA') NOT NULL DEFAULT 'PROGRAMADA',
  `lugar_o_enlace` varchar(500) NULL,
  `acta_resumen` text NULL,
  `creada_por` bigint unsigned NOT NULL,
  `cerrada_at` timestamp NULL,
  `publicada_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `aclar_juntas_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `aclar_juntas_tenant_lic_uq` (`tenant_id`,`licitacion_id`),
  KEY `aclar_juntas_tenant_estado_idx` (`tenant_id`,`estado`),
  CONSTRAINT `aclar_juntas_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `aclar_juntas_exp_fk` FOREIGN KEY (`tenant_id`,`expediente_id`,`licitacion_id`) REFERENCES `expedientes` (`tenant_id`,`id`,`licitacion_id`) ON DELETE RESTRICT,
  CONSTRAINT `aclar_juntas_actor_fk` FOREIGN KEY (`tenant_id`,`creada_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE `aclaraciones_preguntas` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `junta_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `proveedor_id` bigint unsigned NOT NULL,
  `folio` varchar(40) NOT NULL,
  `pregunta` text NOT NULL,
  `estado` enum('RECIBIDA','ADMITIDA','RECHAZADA','RESPONDIDA') NOT NULL DEFAULT 'RECIBIDA',
  `motivo_rechazo` text NULL,
  `creada_por` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `aclar_preg_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `aclar_preg_tenant_folio_uq` (`tenant_id`,`junta_id`,`folio`),
  KEY `aclar_preg_junta_idx` (`tenant_id`,`junta_id`),
  CONSTRAINT `aclar_preg_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `aclar_preg_junta_fk` FOREIGN KEY (`tenant_id`,`junta_id`) REFERENCES `aclaraciones_juntas` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `aclar_preg_prov_fk` FOREIGN KEY (`tenant_id`,`proveedor_id`) REFERENCES `proveedores` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `aclar_preg_actor_fk` FOREIGN KEY (`tenant_id`,`creada_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE `aclaraciones_respuestas` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `pregunta_id` bigint unsigned NOT NULL,
  `junta_id` bigint unsigned NOT NULL,
  `respuesta` text NOT NULL,
  `es_publica` tinyint(1) NOT NULL DEFAULT 1,
  `respondida_por` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `aclar_resp_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `aclar_resp_pregunta_uq` (`tenant_id`,`pregunta_id`),
  CONSTRAINT `aclar_resp_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `aclar_resp_preg_fk` FOREIGN KEY (`tenant_id`,`pregunta_id`) REFERENCES `aclaraciones_preguntas` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `aclar_resp_junta_fk` FOREIGN KEY (`tenant_id`,`junta_id`) REFERENCES `aclaraciones_juntas` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `aclar_resp_actor_fk` FOREIGN KEY (`tenant_id`,`respondida_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ========== APERTURA GOBERNADA ==========
CREATE TABLE `aperturas` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `expediente_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `estado` enum('RECEPCION_ABIERTA','RECEPCION_CERRADA','SELLADA','ABIERTA','REGISTRADA','ACTA_EMITIDA','PUBLICADA') NOT NULL DEFAULT 'RECEPCION_ABIERTA',
  `sello_hash` varchar(64) NULL,
  `fecha_cierre_recepcion` timestamp NULL,
  `fecha_sellado` timestamp NULL,
  `fecha_apertura` timestamp NULL,
  `fecha_acta` timestamp NULL,
  `fecha_publicacion` timestamp NULL,
  `acta_resumen` text NULL,
  `ofertas_registradas` int NOT NULL DEFAULT 0,
  `creada_por` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `aperturas_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `aperturas_tenant_lic_uq` (`tenant_id`,`licitacion_id`),
  KEY `aperturas_tenant_estado_idx` (`tenant_id`,`estado`),
  CONSTRAINT `aperturas_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `aperturas_exp_fk` FOREIGN KEY (`tenant_id`,`expediente_id`,`licitacion_id`) REFERENCES `expedientes` (`tenant_id`,`id`,`licitacion_id`) ON DELETE RESTRICT,
  CONSTRAINT `aperturas_actor_fk` FOREIGN KEY (`tenant_id`,`creada_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `apertura_ofertas_nonneg` CHECK (`ofertas_registradas` >= 0)
) ENGINE=InnoDB;

-- Composite identity for participaciones (evidence-safe refs)
ALTER TABLE `participaciones`
  ADD UNIQUE KEY `participaciones_tenant_id_uq` (`tenant_id`,`id`);

CREATE TABLE `apertura_registros` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `apertura_id` bigint unsigned NOT NULL,
  `participacion_id` bigint unsigned NOT NULL,
  `proveedor_id` bigint unsigned NOT NULL,
  `monto_oferta` decimal(18,2) NOT NULL,
  `presente` tinyint(1) NOT NULL DEFAULT 1,
  `observaciones` text NULL,
  `registrado_por` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `apertura_reg_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `apertura_reg_part_uq` (`tenant_id`,`apertura_id`,`participacion_id`),
  CONSTRAINT `apertura_reg_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `apertura_reg_apertura_fk` FOREIGN KEY (`tenant_id`,`apertura_id`) REFERENCES `aperturas` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `apertura_reg_part_fk` FOREIGN KEY (`tenant_id`,`participacion_id`) REFERENCES `participaciones` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `apertura_reg_prov_fk` FOREIGN KEY (`tenant_id`,`proveedor_id`) REFERENCES `proveedores` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `apertura_reg_actor_fk` FOREIGN KEY (`tenant_id`,`registrado_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `apertura_reg_monto_nonneg` CHECK (`monto_oferta` >= 0)
) ENGINE=InnoDB;

-- ========== DICTAMEN ==========
CREATE TABLE `dictamenes` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `expediente_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `estado` enum('BORRADOR','EMITIDO','APROBADO','RECHAZADO') NOT NULL DEFAULT 'BORRADOR',
  `resultado` enum('RECOMENDAR_ADJUDICACION','DECLARAR_DESIERTO','RECOMENDAR_CANCELACION') NULL,
  `proveedor_recomendado_id` bigint unsigned NULL,
  `monto_recomendado` decimal(18,2) NULL,
  `fundamento` text NOT NULL,
  `emitido_por` bigint unsigned NULL,
  `aprobado_por` bigint unsigned NULL,
  `emitido_at` timestamp NULL,
  `aprobado_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `dictamenes_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `dictamenes_tenant_lic_ver_uq` (`tenant_id`,`licitacion_id`,`version`),
  KEY `dictamenes_tenant_estado_idx` (`tenant_id`,`licitacion_id`,`estado`),
  CONSTRAINT `dictamenes_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `dictamenes_exp_fk` FOREIGN KEY (`tenant_id`,`expediente_id`,`licitacion_id`) REFERENCES `expedientes` (`tenant_id`,`id`,`licitacion_id`) ON DELETE RESTRICT,
  CONSTRAINT `dictamenes_prov_fk` FOREIGN KEY (`tenant_id`,`proveedor_recomendado_id`) REFERENCES `proveedores` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `dictamenes_emit_fk` FOREIGN KEY (`tenant_id`,`emitido_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `dictamenes_aprob_fk` FOREIGN KEY (`tenant_id`,`aprobado_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `dictamen_version_pos` CHECK (`version` > 0),
  CONSTRAINT `dictamen_monto_nonneg` CHECK (`monto_recomendado` IS NULL OR `monto_recomendado` >= 0)
) ENGINE=InnoDB;

CREATE TABLE `dictamen_firmantes` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `dictamen_id` bigint unsigned NOT NULL,
  `usuario_id` bigint unsigned NOT NULL,
  `rol_firma` varchar(80) NOT NULL,
  `firmado` tinyint(1) NOT NULL DEFAULT 0,
  `firmado_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `dict_firm_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `dict_firm_uq` (`tenant_id`,`dictamen_id`,`usuario_id`),
  CONSTRAINT `dict_firm_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `dict_firm_dict_fk` FOREIGN KEY (`tenant_id`,`dictamen_id`) REFERENCES `dictamenes` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `dict_firm_user_fk` FOREIGN KEY (`tenant_id`,`usuario_id`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ========== FALLO ==========
CREATE TABLE `fallos` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `expediente_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `dictamen_id` bigint unsigned NOT NULL,
  `estado` enum('BORRADOR','EMITIDO','APROBADO','PUBLICADO') NOT NULL DEFAULT 'BORRADOR',
  `sentido` enum('ADJUDICAR','DESIERTO','CANCELAR') NOT NULL,
  `proveedor_ganador_id` bigint unsigned NULL,
  `monto_adjudicado` decimal(18,2) NULL,
  `fundamento` text NOT NULL,
  `emitido_por` bigint unsigned NULL,
  `aprobado_por` bigint unsigned NULL,
  `emitido_at` timestamp NULL,
  `aprobado_at` timestamp NULL,
  `publicado_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `fallos_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `fallos_tenant_lic_uq` (`tenant_id`,`licitacion_id`),
  KEY `fallos_tenant_estado_idx` (`tenant_id`,`estado`),
  CONSTRAINT `fallos_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fallos_exp_fk` FOREIGN KEY (`tenant_id`,`expediente_id`,`licitacion_id`) REFERENCES `expedientes` (`tenant_id`,`id`,`licitacion_id`) ON DELETE RESTRICT,
  CONSTRAINT `fallos_dict_fk` FOREIGN KEY (`tenant_id`,`dictamen_id`) REFERENCES `dictamenes` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fallos_prov_fk` FOREIGN KEY (`tenant_id`,`proveedor_ganador_id`) REFERENCES `proveedores` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fallos_emit_fk` FOREIGN KEY (`tenant_id`,`emitido_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fallos_aprob_fk` FOREIGN KEY (`tenant_id`,`aprobado_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `fallo_monto_nonneg` CHECK (`monto_adjudicado` IS NULL OR `monto_adjudicado` >= 0)
) ENGINE=InnoDB;

-- ========== CONTRATOS ==========
CREATE TABLE `contratos` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `expediente_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `fallo_id` bigint unsigned NOT NULL,
  `proveedor_id` bigint unsigned NOT NULL,
  `folio` varchar(80) NOT NULL,
  `estado` enum('BORRADOR','FORMALIZADO','VIGENTE','TERMINADO','RESCINDIDO') NOT NULL DEFAULT 'BORRADOR',
  `monto` decimal(18,2) NOT NULL,
  `moneda` enum('MXN') NOT NULL DEFAULT 'MXN',
  `objeto` text NOT NULL,
  `fecha_inicio` date NULL,
  `fecha_fin` date NULL,
  `fecha_firma` date NULL,
  `formalizado_por` bigint unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `contratos_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `contratos_tenant_folio_uq` (`tenant_id`,`folio`),
  UNIQUE KEY `contratos_tenant_lic_uq` (`tenant_id`,`licitacion_id`),
  KEY `contratos_tenant_estado_idx` (`tenant_id`,`estado`),
  CONSTRAINT `contratos_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `contratos_exp_fk` FOREIGN KEY (`tenant_id`,`expediente_id`,`licitacion_id`) REFERENCES `expedientes` (`tenant_id`,`id`,`licitacion_id`) ON DELETE RESTRICT,
  CONSTRAINT `contratos_fallo_fk` FOREIGN KEY (`tenant_id`,`fallo_id`) REFERENCES `fallos` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `contratos_prov_fk` FOREIGN KEY (`tenant_id`,`proveedor_id`) REFERENCES `proveedores` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `contratos_actor_fk` FOREIGN KEY (`tenant_id`,`formalizado_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `contrato_monto_nonneg` CHECK (`monto` >= 0)
) ENGINE=InnoDB;

-- ========== GARANTÍAS ==========
CREATE TABLE `garantias` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `contrato_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `proveedor_id` bigint unsigned NOT NULL,
  `tipo` enum('CUMPLIMIENTO','ANTICIPO','VICIOS_OCULTOS','SERIEDAD') NOT NULL,
  `estado` enum('REQUERIDA','PRESENTADA','VIGENTE','LIBERADA','EJECUTADA','VENCIDA') NOT NULL DEFAULT 'REQUERIDA',
  `monto` decimal(18,2) NOT NULL,
  `moneda` enum('MXN') NOT NULL DEFAULT 'MXN',
  `instrumento` varchar(120) NULL,
  `numero_poliza` varchar(80) NULL,
  `fecha_inicio` date NULL,
  `fecha_vencimiento` date NULL,
  `presentada_at` timestamp NULL,
  `liberada_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `garantias_tenant_id_uq` (`tenant_id`,`id`),
  KEY `garantias_contrato_idx` (`tenant_id`,`contrato_id`),
  KEY `garantias_estado_idx` (`tenant_id`,`estado`),
  CONSTRAINT `garantias_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `garantias_contrato_fk` FOREIGN KEY (`tenant_id`,`contrato_id`) REFERENCES `contratos` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `garantias_prov_fk` FOREIGN KEY (`tenant_id`,`proveedor_id`) REFERENCES `proveedores` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `garantia_monto_nonneg` CHECK (`monto` >= 0)
) ENGINE=InnoDB;
