-- 0023 Investigación de mercado como estudio previo (no RFQ / no proposición).
-- market_invitations (0022) queda sin API: no es canal de cotización transaccional.

CREATE TABLE IF NOT EXISTS `fuentes_mercado` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `investigacion_id` bigint unsigned NOT NULL,
  `tipo` enum('PLATAFORMA_HISTORICA','CAMARA_ORGANISMO','CONSULTA_WEB','OFICIO','SOLICITUD_INFORMATIVA','TABULADOR_RAMO','PRESUPUESTO_BASE') NOT NULL,
  `descripcion` text NOT NULL,
  `consultada_at` datetime(6) NOT NULL,
  `documento_id` bigint unsigned NOT NULL,
  `url_o_referencia` varchar(400) NULL,
  `precio_observado` decimal(18,2) NULL,
  `comparable` tinyint(1) NOT NULL DEFAULT 1,
  `notas_comparabilidad` text NULL,
  `registrada_por` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `fuente_merc_tenant_id_uq` (`tenant_id`, `id`),
  KEY `fuente_merc_inv_idx` (`tenant_id`, `investigacion_id`),
  KEY `fuente_merc_tipo_idx` (`tenant_id`, `investigacion_id`, `tipo`),
  CONSTRAINT `fuente_merc_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

ALTER TABLE `investigaciones_mercado`
  ADD COLUMN `marco` enum('LAASSP','LOPSRM') NOT NULL DEFAULT 'LAASSP' AFTER `objeto`,
  ADD COLUMN `existencia_oferta` tinyint(1) NULL AFTER `precio_referencia`,
  ADD COLUMN `potenciales_identificados` int unsigned NULL AFTER `existencia_oferta`,
  ADD COLUMN `modalidad_recomendada` varchar(80) NULL AFTER `potenciales_identificados`,
  ADD COLUMN `documento_dictamen_id` bigint unsigned NULL AFTER `modalidad_recomendada`;
