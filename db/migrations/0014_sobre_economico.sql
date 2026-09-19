-- Piedra Angular 0014: economic envelope encryption (AES-256-GCM) + system actor seed helper notes
-- MySQL/MariaDB-valid. Idempotent where practical.
--
-- Key rotation stub:
--   ARES_ENVELOPE_KEY          → active write key (base64 or hex, 32 bytes)
--   ARES_ENVELOPE_KEY_VERSION  → integer written into sobres_economicos.key_version (default 1)
--   ARES_ENVELOPE_KEY_V{n}     → optional decrypt-only keys for prior versions
-- Rotate: set V{old}=old material, bump VERSION + KEY to new, re-encrypt at leisure (ops job TBD).

CREATE TABLE IF NOT EXISTS `sobres_economicos` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `participacion_id` bigint unsigned NOT NULL,
  `proposicion_id` bigint unsigned NULL,
  `ciphertext` text NOT NULL,
  `nonce_iv` varchar(64) NOT NULL,
  `auth_tag` varchar(64) NOT NULL,
  `key_version` int unsigned NOT NULL DEFAULT 1,
  `algorithm` varchar(32) NOT NULL DEFAULT 'AES-256-GCM',
  `estado` enum('SELLADO','REVELADO') NOT NULL DEFAULT 'SELLADO',
  `revelado_at` timestamp NULL,
  `revelado_por` bigint unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sobre_econ_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `sobre_econ_part_uq` (`tenant_id`,`participacion_id`),
  KEY `sobre_econ_estado_idx` (`tenant_id`,`estado`),
  CONSTRAINT `sobre_econ_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `sobre_econ_part_fk` FOREIGN KEY (`tenant_id`,`participacion_id`) REFERENCES `participaciones` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- System actor: seeded at runtime by ensureSystemActor(tenantId).
-- Email pattern: system+t{tenantId}@piedra-angular.local
-- Legacy alias: system@piedra-angular.local (single-tenant demos)
-- password_hash NULL + activo=0 → login rejected (auth-router requires passwordHash && activo).
