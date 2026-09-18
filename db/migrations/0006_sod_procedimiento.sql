-- ARES 0006: SoD por procedimiento + seed de incompatibilidades + evidencia documental en garantías/contratos.
-- MySQL-valid bigint unsigned (same style as 0004/0005).

-- ========== Procedure-level role assignments ==========
CREATE TABLE IF NOT EXISTS `procedimiento_asignaciones` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `rol` varchar(64) NOT NULL,
  `override_sod` tinyint(1) NOT NULL DEFAULT 0,
  `justificacion_override` text NULL,
  `asignado_por` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `proc_asig_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `proc_asig_uq` (`tenant_id`,`licitacion_id`,`user_id`,`rol`),
  KEY `proc_asig_lic_idx` (`tenant_id`,`licitacion_id`),
  CONSTRAINT `proc_asig_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `proc_asig_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `proc_asig_user_fk` FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `proc_asig_actor_fk` FOREIGN KEY (`tenant_id`,`asignado_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ========== Document evidence columns ==========
ALTER TABLE `garantias`
  ADD COLUMN IF NOT EXISTS `documento_id` bigint unsigned NULL AFTER `numero_poliza`;

ALTER TABLE `contratos`
  ADD COLUMN IF NOT EXISTS `documento_contrato_id` bigint unsigned NULL AFTER `formalizado_por`,
  ADD COLUMN IF NOT EXISTS `causa_rescision` text NULL AFTER `documento_contrato_id`,
  ADD COLUMN IF NOT EXISTS `resolucion_rescision` text NULL AFTER `causa_rescision`,
  ADD COLUMN IF NOT EXISTS `documento_rescision_id` bigint unsigned NULL AFTER `resolucion_rescision`;

-- ========== Seed default capability incompatibilities (idempotent) ==========
INSERT IGNORE INTO `capability_incompatibilidades` (`capability_a`, `capability_b`, `motivo`, `activa`) VALUES
  ('evaluar_tecnico', 'autorizar_fallo', 'Segregación: evaluar vs autorizar fallo.', 1),
  ('evaluar_economico', 'autorizar_fallo', 'Segregación: evaluar vs autorizar fallo.', 1),
  ('presentar_pago', 'aprobar_pago', 'Segregación: presentar vs aprobar pago.', 1),
  ('investigar_sancion', 'administrar_sancion', 'Segregación: investigar vs administrar sanción.', 1);
