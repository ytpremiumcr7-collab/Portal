-- ARES 0011: audit harden + governmental MVP tables.
-- MySQL/MariaDB-valid. Idempotent where practical.

-- 1) Authoritative reception timestamp on participación
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'participaciones' AND COLUMN_NAME = 'recibido_at');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `participaciones` ADD COLUMN `recibido_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `observaciones`', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Notification PARCIAL estado
ALTER TABLE `notificaciones`
  MODIFY COLUMN `estado` enum('BORRADOR','REGISTRADA','ENVIADA','ENVIADA_EXTERNA','ENTREGADA','FALLIDA','ACKNOWLEDGED','PARCIAL') NOT NULL DEFAULT 'BORRADOR';

-- 3) Incidencia asignadaA FK (if feasible)
SET @exist := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'incidencias' AND CONSTRAINT_NAME = 'incidencia_asignada_fk');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `incidencias` ADD CONSTRAINT `incidencia_asignada_fk` FOREIGN KEY (`tenant_id`,`asignada_a`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Contract BESA-lite: administrador + penas
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contratos' AND COLUMN_NAME = 'administrador_contrato_id');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `contratos` ADD COLUMN `administrador_contrato_id` bigint unsigned NULL, ADD COLUMN `penas_convencionales` json NULL', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'contratos' AND CONSTRAINT_NAME = 'contratos_admin_fk');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `contratos` ADD CONSTRAINT `contratos_admin_fk` FOREIGN KEY (`tenant_id`,`administrador_contrato_id`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5) Garantía percentage (BESA-lite)
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'garantias' AND COLUMN_NAME = 'porcentaje');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `garantias` ADD COLUMN `porcentaje` decimal(5,2) NULL AFTER `monto`', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 6) CUCoP-lite catalog + link on licitaciones
CREATE TABLE IF NOT EXISTS `catalogo_cucop` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `codigo` varchar(40) NOT NULL,
  `descripcion` varchar(300) NOT NULL,
  `capitulo` varchar(80) NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cucop_codigo_uq` (`codigo`)
) ENGINE=InnoDB;

INSERT IGNORE INTO `catalogo_cucop` (`id`, `codigo`, `descripcion`, `capitulo`, `activo`) VALUES
  (1, '15101500', 'Combustibles', 'Energéticos', 1),
  (2, '43211500', 'Computadoras', 'TIC', 1),
  (3, '80101500', 'Servicios de consultoría de negocios', 'Servicios', 1),
  (4, '72101500', 'Construcción de edificios', 'Obra', 1),
  (5, '44103100', 'Papelería de oficina', 'Materiales', 1);

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'licitaciones' AND COLUMN_NAME = 'cucop_id');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `licitaciones` ADD COLUMN `cucop_id` bigint unsigned NULL', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'licitaciones' AND CONSTRAINT_NAME = 'licitaciones_cucop_fk');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `licitaciones` ADD CONSTRAINT `licitaciones_cucop_fk` FOREIGN KEY (`cucop_id`) REFERENCES `catalogo_cucop` (`id`) ON DELETE RESTRICT', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7) Human adjudication act
CREATE TABLE IF NOT EXISTS `acto_adjudicacion` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `expediente_id` bigint unsigned NOT NULL,
  `propuesta_ranking_json` json NOT NULL,
  `proveedor_propuesto_id` bigint unsigned NOT NULL,
  `proveedor_decidido_id` bigint unsigned NULL,
  `fundamento` text NULL,
  `estado` enum('BORRADOR','PROPUESTO','PUBLICADO','ANULADO') NOT NULL DEFAULT 'BORRADOR',
  `validado_vs_ranking` tinyint(1) NOT NULL DEFAULT 0,
  `desviacion_justificada` tinyint(1) NOT NULL DEFAULT 0,
  `publicado_at` timestamp NULL DEFAULT NULL,
  `creado_por` bigint unsigned NOT NULL,
  `decidido_por` bigint unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `acto_adj_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `acto_adj_lic_uq` (`tenant_id`,`licitacion_id`),
  KEY `acto_adj_estado_idx` (`tenant_id`,`estado`),
  CONSTRAINT `acto_adj_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `acto_adj_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `acto_adj_actor_fk` FOREIGN KEY (`tenant_id`,`creado_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- 8) Comisión evaluadora + COI
CREATE TABLE IF NOT EXISTS `comision_evaluadora` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `rol` enum('PRESIDENTE','SECRETARIO','VOCAL_TECNICO','VOCAL_ECONOMICO','VOCAL') NOT NULL DEFAULT 'VOCAL',
  `activa` tinyint(1) NOT NULL DEFAULT 1,
  `designado_por` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `comision_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `comision_lic_user_uq` (`tenant_id`,`licitacion_id`,`user_id`),
  CONSTRAINT `comision_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `comision_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `comision_user_fk` FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `coi_declaraciones` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `comision_miembro_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `proveedor_id` bigint unsigned NULL,
  `tiene_conflicto` tinyint(1) NOT NULL DEFAULT 0,
  `descripcion` text NOT NULL,
  `recusado` tinyint(1) NOT NULL DEFAULT 0,
  `declarado_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `coi_tenant_id_uq` (`tenant_id`,`id`),
  KEY `coi_lic_idx` (`tenant_id`,`licitacion_id`),
  CONSTRAINT `coi_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `coi_miembro_fk` FOREIGN KEY (`tenant_id`,`comision_miembro_id`) REFERENCES `comision_evaluadora` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `coi_user_fk` FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- 9) Cancelación / desierto as structured acts
CREATE TABLE IF NOT EXISTS `actos_terminacion` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `expediente_id` bigint unsigned NOT NULL,
  `tipo` enum('CANCELACION','DESIERTO') NOT NULL,
  `causa` text NOT NULL,
  `fundamento` text NOT NULL,
  `documento_id` bigint unsigned NULL,
  `estado` enum('BORRADOR','PUBLICADO') NOT NULL DEFAULT 'BORRADOR',
  `publicado_at` timestamp NULL DEFAULT NULL,
  `creado_por` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `acto_term_tenant_id_uq` (`tenant_id`,`id`),
  KEY `acto_term_lic_idx` (`tenant_id`,`licitacion_id`),
  CONSTRAINT `acto_term_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `acto_term_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- 10) Calendario jurídico
CREATE TABLE IF NOT EXISTS `calendario_actos` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `acto` varchar(60) NOT NULL,
  `ventana_inicio` timestamp NOT NULL,
  `ventana_fin` timestamp NOT NULL,
  `obligatorio` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cal_acto_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `cal_acto_lic_acto_uq` (`tenant_id`,`licitacion_id`,`acto`),
  CONSTRAINT `cal_acto_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `cal_acto_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Extend proposicion_documentos.rol for garantía de seriedad
ALTER TABLE `proposicion_documentos`
  MODIFY COLUMN `rol` enum('OFERTA_TECNICA','OFERTA_ECONOMICA','ANEXO','GARANTIA_SERIEDAD') NOT NULL;
