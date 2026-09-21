-- 0022 additive: evidence v2 columns, market invitations, legal hold, anchors.
-- Does not rewrite existing expediente_events hashes.

ALTER TABLE `expediente_events`
  ADD COLUMN `schema_version` smallint unsigned NOT NULL DEFAULT 1 AFTER `secuencia`,
  ADD COLUMN `actor_capability` varchar(100) NULL AFTER `actor_user_id`,
  ADD COLUMN `verified_client_ip` varchar(64) NULL AFTER `ip_address`,
  ADD COLUMN `anchor_status` varchar(32) NULL AFTER `event_hash`;

ALTER TABLE `documentos`
  ADD COLUMN `object_backend` varchar(40) NOT NULL DEFAULT 'filesystem' AFTER `storage_key`,
  ADD COLUMN `object_key` varchar(500) NULL AFTER `object_backend`,
  ADD COLUMN `object_version_id` varchar(300) NULL AFTER `object_key`,
  ADD COLUMN `retention_until` datetime(6) NULL AFTER `object_version_id`,
  ADD COLUMN `legal_hold_active` tinyint(1) NOT NULL DEFAULT 0 AFTER `retention_until`,
  ADD COLUMN `content_verified_at` datetime(6) NULL AFTER `legal_hold_active`;

ALTER TABLE `sessions`
  ADD COLUMN `step_up_until` timestamp NULL AFTER `user_agent`;

ALTER TABLE `users`
  ADD COLUMN `mfa_enabled` tinyint(1) NOT NULL DEFAULT 0 AFTER `activo`;

ALTER TABLE `cotizaciones_mercado`
  ADD COLUMN `procedencia` varchar(32) NOT NULL DEFAULT 'FUENTE_CAPTURADA' AFTER `estado`,
  ADD COLUMN `invitacion_id` bigint unsigned NULL AFTER `procedencia`,
  ADD COLUMN `documento_soporte_id` bigint unsigned NULL AFTER `invitacion_id`,
  ADD COLUMN `receipt_hash` char(64) NULL AFTER `documento_soporte_id`,
  ADD COLUMN `submitted_at` timestamp NULL AFTER `receipt_hash`,
  ADD COLUMN `submitted_by_user_id` bigint unsigned NULL AFTER `submitted_at`;

CREATE TABLE IF NOT EXISTS `market_invitations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `investigacion_id` bigint unsigned NOT NULL,
  `proveedor_consultado_id` bigint unsigned NOT NULL,
  `proveedor_id` bigint unsigned NULL,
  `token_hash` char(64) NOT NULL,
  `estado` enum('EMITIDA','ACEPTADA','RESPONDIDA','VENCIDA','REVOCADA') NOT NULL DEFAULT 'EMITIDA',
  `expires_at` timestamp NOT NULL,
  `respondida_at` timestamp NULL,
  `created_by` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `mkt_inv_tenant_id_uq` (`tenant_id`, `id`),
  UNIQUE KEY `mkt_inv_token_uq` (`token_hash`),
  KEY `mkt_inv_inv_idx` (`tenant_id`, `investigacion_id`),
  CONSTRAINT `mkt_inv_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `legal_holds` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `hold_code` varchar(100) NOT NULL,
  `reason` text NOT NULL,
  `authority_ref` varchar(200) NULL,
  `starts_at` datetime(6) NOT NULL,
  `released_at` datetime(6) NULL,
  `created_by` bigint unsigned NOT NULL,
  `released_by` bigint unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `legal_hold_code_uq` (`tenant_id`, `hold_code`),
  CONSTRAINT `legal_hold_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `legal_hold_targets` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `legal_hold_id` bigint unsigned NOT NULL,
  `target_type` varchar(80) NOT NULL,
  `target_id` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `legal_hold_tgt_uq` (`legal_hold_id`, `target_type`, `target_id`),
  KEY `legal_hold_tgt_lookup` (`tenant_id`, `target_type`, `target_id`),
  CONSTRAINT `legal_hold_tgt_hold_fk` FOREIGN KEY (`legal_hold_id`) REFERENCES `legal_holds` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `evidence_anchors` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `expediente_id` bigint unsigned NULL,
  `event_sequence` int unsigned NULL,
  `event_hash` char(64) NOT NULL,
  `algorithm` varchar(40) NOT NULL DEFAULT 'SHA256',
  `status` enum('PENDING_EXTERNAL','ANCHORED','FAILED') NOT NULL DEFAULT 'PENDING_EXTERNAL',
  `tsa_url` varchar(300) NULL,
  `token` longblob NULL,
  `anchored_at` datetime(6) NULL,
  `last_error` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ev_anchor_hash_idx` (`tenant_id`, `event_hash`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `backup_restore_drills` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NULL,
  `drill_code` varchar(80) NOT NULL,
  `started_at` datetime(6) NOT NULL,
  `finished_at` datetime(6) NULL,
  `status` enum('RUNNING','PASSED','FAILED') NOT NULL DEFAULT 'RUNNING',
  `events_checked` int unsigned NOT NULL DEFAULT 0,
  `documents_checked` int unsigned NOT NULL DEFAULT 0,
  `mismatches` int unsigned NOT NULL DEFAULT 0,
  `report` json NULL,
  `actor_user_id` bigint unsigned NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `backup_drill_code_uq` (`drill_code`)
) ENGINE=InnoDB;
