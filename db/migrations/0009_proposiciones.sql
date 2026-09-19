-- ARES 0009: Proposición aggregate + exclusion + apertura manifest alignment.
-- MySQL-valid. Idempotent CREATE.

CREATE TABLE IF NOT EXISTS `proposiciones` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `proveedor_id` bigint unsigned NOT NULL,
  `participacion_id` bigint unsigned NOT NULL,
  `recibido_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `estado` enum('BORRADOR','RECIBIDA','SELLADA','ADMISIBLE','NO_ADMISIBLE','DESECHADA','GANADORA') NOT NULL DEFAULT 'BORRADOR',
  `manifest_hash` varchar(64) NULL,
  `seal_hash` varchar(64) NULL,
  `sealed_at` timestamp NULL DEFAULT NULL,
  `monto_oferta` decimal(18,2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `prop_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `prop_part_uq` (`tenant_id`,`participacion_id`),
  UNIQUE KEY `prop_lic_prov_uq` (`tenant_id`,`licitacion_id`,`proveedor_id`),
  KEY `prop_lic_idx` (`tenant_id`,`licitacion_id`),
  KEY `prop_estado_idx` (`tenant_id`,`licitacion_id`,`estado`),
  CONSTRAINT `prop_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `prop_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `prop_prov_fk` FOREIGN KEY (`tenant_id`,`proveedor_id`) REFERENCES `proveedores` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `prop_part_fk` FOREIGN KEY (`tenant_id`,`participacion_id`) REFERENCES `participaciones` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `proposicion_documentos` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `proposicion_id` bigint unsigned NOT NULL,
  `documento_id` bigint unsigned NOT NULL,
  `rol` enum('OFERTA_TECNICA','OFERTA_ECONOMICA','ANEXO') NOT NULL,
  `sha256` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `prop_doc_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `prop_doc_uq` (`tenant_id`,`proposicion_id`,`documento_id`),
  KEY `prop_doc_prop_idx` (`tenant_id`,`proposicion_id`),
  CONSTRAINT `prop_doc_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `prop_doc_prop_fk` FOREIGN KEY (`tenant_id`,`proposicion_id`) REFERENCES `proposiciones` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `prop_doc_documento_fk` FOREIGN KEY (`tenant_id`,`documento_id`) REFERENCES `documentos` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `proposicion_exclusiones` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `proposicion_id` bigint unsigned NOT NULL,
  `reason_code` varchar(60) NOT NULL,
  `reason_text` text NOT NULL,
  `evidence_doc_id` bigint unsigned NULL,
  `decided_by` bigint unsigned NOT NULL,
  `decided_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `prop_excl_tenant_id_uq` (`tenant_id`,`id`),
  KEY `prop_excl_prop_idx` (`tenant_id`,`proposicion_id`),
  CONSTRAINT `prop_excl_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `prop_excl_prop_fk` FOREIGN KEY (`tenant_id`,`proposicion_id`) REFERENCES `proposiciones` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `prop_excl_actor_fk` FOREIGN KEY (`tenant_id`,`decided_by`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `prop_excl_doc_fk` FOREIGN KEY (`tenant_id`,`evidence_doc_id`) REFERENCES `documentos` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;
