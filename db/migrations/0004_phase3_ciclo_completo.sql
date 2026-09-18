-- ARES Phase 3: ciclo completo (planeación → mercado → ejecución → pagos → incidencias → sanciones → inconformidades → notificaciones → consulta pública + RBAC por capability)
-- Todas las FKs de evidencia: ON DELETE RESTRICT. ALERTA ≠ SANCIÓN.

-- ========== RBAC capabilities ==========
CREATE TABLE `user_capabilities` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `capability` varchar(64) NOT NULL,
  `granted` tinyint(1) NOT NULL DEFAULT 1,
  `granted_by` bigint unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_caps_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `user_caps_uq` (`tenant_id`,`user_id`,`capability`),
  CONSTRAINT `user_caps_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `user_caps_user_fk` FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ========== PLANEACIÓN ==========
CREATE TABLE `programas_anuales` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `entidad_id` bigint unsigned NOT NULL,
  `anio` int NOT NULL,
  `nombre` varchar(200) NOT NULL,
  `estado` enum('BORRADOR','APROBADO','VIGENTE','CERRADO') NOT NULL DEFAULT 'BORRADOR',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `prog_anual_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `prog_anual_ent_anio_uq` (`tenant_id`,`entidad_id`,`anio`,`nombre`),
  CONSTRAINT `prog_anual_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `prog_anual_ent_fk` FOREIGN KEY (`tenant_id`,`entidad_id`) REFERENCES `entidades` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE `partidas_presupuestarias` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `programa_id` bigint unsigned NOT NULL,
  `codigo` varchar(40) NOT NULL,
  `descripcion` varchar(300) NOT NULL,
  `monto_asignado` decimal(18,2) NOT NULL,
  `monto_comprometido` decimal(18,2) NOT NULL DEFAULT 0.00,
  `fuente_financiamiento` enum('RECURSOS_FISCALES','RECURSOS_PROPIOS','CREDITO','FIDEICOMISO','FEDERAL_ETIQUETADO','OTRO') NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `partida_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `partida_codigo_uq` (`tenant_id`,`programa_id`,`codigo`),
  CONSTRAINT `partida_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `partida_prog_fk` FOREIGN KEY (`tenant_id`,`programa_id`) REFERENCES `programas_anuales` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `partida_montos_nonneg` CHECK (`monto_asignado` >= 0 AND `monto_comprometido` >= 0)
) ENGINE=InnoDB;

CREATE TABLE `necesidades` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `entidad_id` bigint unsigned NOT NULL,
  `partida_id` bigint unsigned NULL,
  `folio` varchar(60) NOT NULL,
  `titulo` varchar(300) NOT NULL,
  `descripcion` text NOT NULL,
  `justificacion` text NOT NULL,
  `estado` enum('BORRADOR','EN_REVISION','APROBADA','RECHAZADA','VINCULADA') NOT NULL DEFAULT 'BORRADOR',
  `monto_estimado` decimal(18,2) NOT NULL,
  `tipo_contratacion_nec` enum('OBRA','SERVICIO','BIENES','CONCESION','ARRENDAMIENTO') NOT NULL,
  `creada_por` bigint unsigned NOT NULL,
  `aprobada_por` bigint unsigned NULL,
  `aprobada_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `necesidades_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `necesidades_folio_uq` (`tenant_id`,`folio`),
  KEY `necesidades_estado_idx` (`tenant_id`,`estado`),
  CONSTRAINT `necesidades_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `necesidades_ent_fk` FOREIGN KEY (`tenant_id`,`entidad_id`) REFERENCES `entidades` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `necesidades_partida_fk` FOREIGN KEY (`tenant_id`,`partida_id`) REFERENCES `partidas_presupuestarias` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `necesidades_actor_fk` FOREIGN KEY (`tenant_id`,`creada_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `necesidad_monto_nonneg` CHECK (`monto_estimado` >= 0)
) ENGINE=InnoDB;

CREATE TABLE `suficiencias_presupuestarias` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `necesidad_id` bigint unsigned NOT NULL,
  `partida_id` bigint unsigned NOT NULL,
  `monto` decimal(18,2) NOT NULL,
  `estado` enum('SOLICITADA','OTORGADA','RECHAZADA','COMPROMETIDA','LIBERADA') NOT NULL DEFAULT 'SOLICITADA',
  `folio` varchar(60) NOT NULL,
  `otorgada_por` bigint unsigned NULL,
  `otorgada_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `suficiencia_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `suficiencia_folio_uq` (`tenant_id`,`folio`),
  CONSTRAINT `suficiencia_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `suficiencia_nec_fk` FOREIGN KEY (`tenant_id`,`necesidad_id`) REFERENCES `necesidades` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `suficiencia_partida_fk` FOREIGN KEY (`tenant_id`,`partida_id`) REFERENCES `partidas_presupuestarias` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `suficiencia_monto_nonneg` CHECK (`monto` >= 0)
) ENGINE=InnoDB;

CREATE TABLE `estrategias_procedimiento` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `necesidad_id` bigint unsigned NOT NULL,
  `modalidad` enum('LICITACION_PUBLICA','INVITACION_RESTRINGIDA','ADJUDICACION_DIRECTA') NOT NULL,
  `justificacion_modalidad` text NOT NULL,
  `procedencia` text NOT NULL,
  `estado` enum('BORRADOR','APROBADA','APLICADA') NOT NULL DEFAULT 'BORRADOR',
  `licitacion_id` bigint unsigned NULL,
  `creada_por` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `estrategia_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `estrategia_nec_uq` (`tenant_id`,`necesidad_id`),
  CONSTRAINT `estrategia_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `estrategia_nec_fk` FOREIGN KEY (`tenant_id`,`necesidad_id`) REFERENCES `necesidades` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `estrategia_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `estrategia_actor_fk` FOREIGN KEY (`tenant_id`,`creada_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ========== INVESTIGACIÓN DE MERCADO ==========
CREATE TABLE `investigaciones_mercado` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `necesidad_id` bigint unsigned NULL,
  `licitacion_id` bigint unsigned NULL,
  `folio` varchar(60) NOT NULL,
  `objeto` text NOT NULL,
  `estado` enum('BORRADOR','EN_CONSULTA','CERRADA','CONCLUIDA','CANCELADA') NOT NULL DEFAULT 'BORRADOR',
  `resultado` text NULL,
  `conclusion` text NULL,
  `precio_referencia` decimal(18,2) NULL,
  `creada_por` bigint unsigned NOT NULL,
  `concluida_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `inv_mercado_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `inv_mercado_folio_uq` (`tenant_id`,`folio`),
  KEY `inv_mercado_estado_idx` (`tenant_id`,`estado`),
  CONSTRAINT `inv_mercado_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `inv_mercado_nec_fk` FOREIGN KEY (`tenant_id`,`necesidad_id`) REFERENCES `necesidades` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `inv_mercado_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `inv_mercado_actor_fk` FOREIGN KEY (`tenant_id`,`creada_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE `proveedores_consultados` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `investigacion_id` bigint unsigned NOT NULL,
  `proveedor_id` bigint unsigned NULL,
  `razon_social_externa` varchar(200) NULL,
  `fuente` varchar(200) NULL,
  `consultado_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `prov_cons_tenant_id_uq` (`tenant_id`,`id`),
  KEY `prov_cons_inv_idx` (`tenant_id`,`investigacion_id`),
  CONSTRAINT `prov_cons_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `prov_cons_inv_fk` FOREIGN KEY (`tenant_id`,`investigacion_id`) REFERENCES `investigaciones_mercado` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `prov_cons_prov_fk` FOREIGN KEY (`tenant_id`,`proveedor_id`) REFERENCES `proveedores` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE `cotizaciones_mercado` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `investigacion_id` bigint unsigned NOT NULL,
  `proveedor_consultado_id` bigint unsigned NOT NULL,
  `monto` decimal(18,2) NOT NULL,
  `moneda_cot` enum('MXN') NOT NULL DEFAULT 'MXN',
  `vigencia_hasta` date NULL,
  `observaciones` text NULL,
  `estado` enum('RECIBIDA','VALIDADA','DESCARTADA') NOT NULL DEFAULT 'RECIBIDA',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cotiz_merc_tenant_id_uq` (`tenant_id`,`id`),
  KEY `cotiz_merc_inv_idx` (`tenant_id`,`investigacion_id`),
  CONSTRAINT `cotiz_merc_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `cotiz_merc_inv_fk` FOREIGN KEY (`tenant_id`,`investigacion_id`) REFERENCES `investigaciones_mercado` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `cotiz_merc_pc_fk` FOREIGN KEY (`tenant_id`,`proveedor_consultado_id`) REFERENCES `proveedores_consultados` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `cotiz_monto_nonneg` CHECK (`monto` >= 0)
) ENGINE=InnoDB;

-- ========== PROCEDIMIENTO enrichment ==========
CREATE TABLE `procedimiento_eventos` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `expediente_id` bigint unsigned NULL,
  `tipo` varchar(80) NOT NULL,
  `estado_anterior` varchar(40) NULL,
  `estado_nuevo` varchar(40) NULL,
  `plazo_limite` timestamp NULL,
  `actor_user_id` bigint unsigned NOT NULL,
  `motivo` text NULL,
  `payload` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `proc_evt_tenant_id_uq` (`tenant_id`,`id`),
  KEY `proc_evt_lic_idx` (`tenant_id`,`licitacion_id`,`created_at`),
  CONSTRAINT `proc_evt_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `proc_evt_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `proc_evt_actor_fk` FOREIGN KEY (`tenant_id`,`actor_user_id`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE `procedimiento_plazos` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `codigo` varchar(60) NOT NULL,
  `nombre` varchar(180) NOT NULL,
  `fecha_limite` timestamp NOT NULL,
  `cumplido` tinyint(1) NOT NULL DEFAULT 0,
  `cumplido_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `proc_plazo_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `proc_plazo_codigo_uq` (`tenant_id`,`licitacion_id`,`codigo`),
  CONSTRAINT `proc_plazo_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `proc_plazo_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ========== ADMINISTRACIÓN CONTRACTUAL ==========
CREATE TABLE `modificaciones_contractuales` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `contrato_id` bigint unsigned NOT NULL,
  `tipo` enum('CONVENIO','AMPLIACION','REDUCCION','PRORROGA','REPROGRAMACION') NOT NULL,
  `folio` varchar(80) NOT NULL,
  `justificacion` text NOT NULL,
  `monto_delta` decimal(18,2) NULL,
  `dias_prorroga` int NULL,
  `estado` enum('BORRADOR','EN_REVISION','APROBADA','RECHAZADA','FORMALIZADA') NOT NULL DEFAULT 'BORRADOR',
  `aprobada_por` bigint unsigned NULL,
  `aprobada_at` timestamp NULL,
  `formalizada_at` timestamp NULL,
  `creada_por` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `mod_cont_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `mod_cont_folio_uq` (`tenant_id`,`folio`),
  KEY `mod_cont_contrato_idx` (`tenant_id`,`contrato_id`),
  CONSTRAINT `mod_cont_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `mod_cont_contrato_fk` FOREIGN KEY (`tenant_id`,`contrato_id`) REFERENCES `contratos` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `mod_cont_actor_fk` FOREIGN KEY (`tenant_id`,`creada_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE `ejecuciones_contractuales` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `contrato_id` bigint unsigned NOT NULL,
  `estado` enum('NO_INICIADA','EN_EJECUCION','SUSPENDIDA','TERMINADA','FINIQUITADA') NOT NULL DEFAULT 'NO_INICIADA',
  `fecha_inicio` date NULL,
  `fecha_terminacion` date NULL,
  `porcentaje_avance` decimal(5,2) NOT NULL DEFAULT 0.00,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ejec_cont_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `ejec_cont_contrato_uq` (`tenant_id`,`contrato_id`),
  CONSTRAINT `ejec_cont_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `ejec_cont_contrato_fk` FOREIGN KEY (`tenant_id`,`contrato_id`) REFERENCES `contratos` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `ejec_avance_rango` CHECK (`porcentaje_avance` >= 0 AND `porcentaje_avance` <= 100)
) ENGINE=InnoDB;

CREATE TABLE `entregables` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `ejecucion_id` bigint unsigned NOT NULL,
  `contrato_id` bigint unsigned NOT NULL,
  `descripcion` text NOT NULL,
  `fecha_programada` date NULL,
  `estado` enum('PENDIENTE','ENTREGADO','ACEPTADO','RECHAZADO') NOT NULL DEFAULT 'PENDIENTE',
  `aceptado_por` bigint unsigned NULL,
  `aceptado_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `entregable_tenant_id_uq` (`tenant_id`,`id`),
  KEY `entregable_ejec_idx` (`tenant_id`,`ejecucion_id`),
  CONSTRAINT `entregable_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `entregable_ejec_fk` FOREIGN KEY (`tenant_id`,`ejecucion_id`) REFERENCES `ejecuciones_contractuales` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `entregable_contrato_fk` FOREIGN KEY (`tenant_id`,`contrato_id`) REFERENCES `contratos` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE `finiquitos` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `contrato_id` bigint unsigned NOT NULL,
  `ejecucion_id` bigint unsigned NOT NULL,
  `folio` varchar(80) NOT NULL,
  `monto_final` decimal(18,2) NOT NULL,
  `estado` enum('BORRADOR','EMITIDO','FIRMADO') NOT NULL DEFAULT 'BORRADOR',
  `firmado_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `finiquito_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `finiquito_folio_uq` (`tenant_id`,`folio`),
  UNIQUE KEY `finiquito_contrato_uq` (`tenant_id`,`contrato_id`),
  CONSTRAINT `finiquito_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `finiquito_contrato_fk` FOREIGN KEY (`tenant_id`,`contrato_id`) REFERENCES `contratos` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `finiquito_ejec_fk` FOREIGN KEY (`tenant_id`,`ejecucion_id`) REFERENCES `ejecuciones_contractuales` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `finiquito_monto_nonneg` CHECK (`monto_final` >= 0)
) ENGINE=InnoDB;

-- ========== PAGOS / ESTIMACIONES ==========
CREATE TABLE `estimaciones_pago` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `contrato_id` bigint unsigned NOT NULL,
  `folio` varchar(80) NOT NULL,
  `numero` int NOT NULL,
  `monto_bruto` decimal(18,2) NOT NULL,
  `retencion` decimal(18,2) NOT NULL DEFAULT 0.00,
  `monto_neto` decimal(18,2) NOT NULL,
  `estado` enum('PRESENTADA','EN_REVISION','AUTORIZADA','PAGADA','RECHAZADA') NOT NULL DEFAULT 'PRESENTADA',
  `presentada_por` bigint unsigned NOT NULL,
  `revisada_por` bigint unsigned NULL,
  `autorizada_por` bigint unsigned NULL,
  `pagada_at` timestamp NULL,
  `motivo_rechazo` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `estimacion_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `estimacion_folio_uq` (`tenant_id`,`folio`),
  UNIQUE KEY `estimacion_num_uq` (`tenant_id`,`contrato_id`,`numero`),
  KEY `estimacion_estado_idx` (`tenant_id`,`estado`),
  CONSTRAINT `estimacion_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `estimacion_contrato_fk` FOREIGN KEY (`tenant_id`,`contrato_id`) REFERENCES `contratos` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `estimacion_actor_fk` FOREIGN KEY (`tenant_id`,`presentada_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `estimacion_montos_nonneg` CHECK (`monto_bruto` >= 0 AND `retencion` >= 0 AND `monto_neto` >= 0)
) ENGINE=InnoDB;

-- ========== INCIDENCIAS ==========
CREATE TABLE `incidencias` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `contrato_id` bigint unsigned NULL,
  `licitacion_id` bigint unsigned NULL,
  `proveedor_id` bigint unsigned NULL,
  `tipo` enum('INCUMPLIMIENTO','OBSERVACION','RETRASO','CALIDAD','OTRO') NOT NULL,
  `titulo` varchar(200) NOT NULL,
  `descripcion` text NOT NULL,
  `estado` enum('ABIERTA','EN_ANALISIS','ACCION_CORRECTIVA','RESUELTA','ESCALADA','CERRADA') NOT NULL DEFAULT 'ABIERTA',
  `accion_correctiva` text NULL,
  `reportada_por` bigint unsigned NOT NULL,
  `asignada_a` bigint unsigned NULL,
  `resuelta_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `incidencia_tenant_id_uq` (`tenant_id`,`id`),
  KEY `incidencia_estado_idx` (`tenant_id`,`estado`),
  CONSTRAINT `incidencia_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `incidencia_contrato_fk` FOREIGN KEY (`tenant_id`,`contrato_id`) REFERENCES `contratos` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `incidencia_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `incidencia_prov_fk` FOREIGN KEY (`tenant_id`,`proveedor_id`) REFERENCES `proveedores` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `incidencia_actor_fk` FOREIGN KEY (`tenant_id`,`reportada_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ========== SANCIONES (≠ alertas) ==========
CREATE TABLE `investigaciones_sancion` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `alerta_id` bigint unsigned NULL,
  `incidencia_id` bigint unsigned NULL,
  `proveedor_id` bigint unsigned NOT NULL,
  `folio` varchar(60) NOT NULL,
  `estado` enum('ABIERTA','EN_TRAMITE','CERRADA_SIN_SANCION','DERIVADA_SANCION') NOT NULL DEFAULT 'ABIERTA',
  `resumen` text NOT NULL,
  `abierta_por` bigint unsigned NOT NULL,
  `cerrada_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `inv_sanc_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `inv_sanc_folio_uq` (`tenant_id`,`folio`),
  CONSTRAINT `inv_sanc_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `inv_sanc_prov_fk` FOREIGN KEY (`tenant_id`,`proveedor_id`) REFERENCES `proveedores` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `inv_sanc_actor_fk` FOREIGN KEY (`tenant_id`,`abierta_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE `sanciones` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `proveedor_id` bigint unsigned NOT NULL,
  `investigacion_id` bigint unsigned NULL,
  `tipo` enum('AMONESTACION','MULTA','INHABILITACION','RESCISION','IMPEDIMENTO') NOT NULL,
  `fundamento` text NOT NULL,
  `autoridad` varchar(200) NOT NULL,
  `resolucion` text NOT NULL,
  `folio` varchar(80) NOT NULL,
  `estado` enum('BORRADOR','EMITIDA','VIGENTE','CUMPLIDA','REVOCADA') NOT NULL DEFAULT 'BORRADOR',
  `vigencia_inicio` date NULL,
  `vigencia_fin` date NULL,
  `monto_multa` decimal(18,2) NULL,
  `impedimento_participacion` tinyint(1) NOT NULL DEFAULT 0,
  `emitida_por` bigint unsigned NULL,
  `emitida_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sancion_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `sancion_folio_uq` (`tenant_id`,`folio`),
  KEY `sancion_prov_idx` (`tenant_id`,`proveedor_id`,`estado`),
  CONSTRAINT `sancion_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `sancion_prov_fk` FOREIGN KEY (`tenant_id`,`proveedor_id`) REFERENCES `proveedores` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `sancion_inv_fk` FOREIGN KEY (`tenant_id`,`investigacion_id`) REFERENCES `investigaciones_sancion` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE `proveedores_impedidos` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `proveedor_id` bigint unsigned NOT NULL,
  `sancion_id` bigint unsigned NOT NULL,
  `motivo` text NOT NULL,
  `vigente_desde` date NOT NULL,
  `vigente_hasta` date NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `prov_imp_tenant_id_uq` (`tenant_id`,`id`),
  KEY `prov_imp_activo_idx` (`tenant_id`,`proveedor_id`,`activo`),
  CONSTRAINT `prov_imp_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `prov_imp_prov_fk` FOREIGN KEY (`tenant_id`,`proveedor_id`) REFERENCES `proveedores` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `prov_imp_sanc_fk` FOREIGN KEY (`tenant_id`,`sancion_id`) REFERENCES `sanciones` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ========== INCONFORMIDADES ==========
CREATE TABLE `inconformidades` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `licitacion_id` bigint unsigned NOT NULL,
  `promovente_proveedor_id` bigint unsigned NULL,
  `promovente_nombre` varchar(200) NOT NULL,
  `acto_impugnado` varchar(200) NOT NULL,
  `argumentos` text NOT NULL,
  `evidencias` text NULL,
  `folio` varchar(80) NOT NULL,
  `estado` enum('PRESENTADA','ADMITIDA','EN_TRAMITE','RESUELTA','DESECHADA','SOBRESEIDA') NOT NULL DEFAULT 'PRESENTADA',
  `plazo_respuesta` timestamp NULL,
  `resolucion` text NULL,
  `resuelta_por` bigint unsigned NULL,
  `resuelta_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `inconf_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `inconf_folio_uq` (`tenant_id`,`folio`),
  KEY `inconf_estado_idx` (`tenant_id`,`estado`),
  CONSTRAINT `inconf_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `inconf_lic_fk` FOREIGN KEY (`tenant_id`,`licitacion_id`) REFERENCES `licitaciones` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `inconf_prov_fk` FOREIGN KEY (`tenant_id`,`promovente_proveedor_id`) REFERENCES `proveedores` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ========== NOTIFICACIONES ==========
CREATE TABLE `notificacion_templates` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `codigo` varchar(60) NOT NULL,
  `nombre` varchar(160) NOT NULL,
  `asunto` varchar(300) NOT NULL,
  `cuerpo` text NOT NULL,
  `efecto_legal` tinyint(1) NOT NULL DEFAULT 0,
  `activa` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `notif_tpl_tenant_id_uq` (`tenant_id`,`id`),
  UNIQUE KEY `notif_tpl_codigo_uq` (`tenant_id`,`codigo`),
  CONSTRAINT `notif_tpl_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE `notificaciones` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `template_id` bigint unsigned NULL,
  `codigo_evento` varchar(80) NOT NULL,
  `asunto` varchar(300) NOT NULL,
  `cuerpo` text NOT NULL,
  `efecto_legal` tinyint(1) NOT NULL DEFAULT 0,
  `entidad_ref` varchar(80) NULL,
  `entidad_id` bigint unsigned NULL,
  `licitacion_id` bigint unsigned NULL,
  `estado` enum('BORRADOR','ENVIADA','ENTREGADA','FALLIDA','ACKNOWLEDGED') NOT NULL DEFAULT 'BORRADOR',
  `creada_por` bigint unsigned NOT NULL,
  `enviada_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `notif_tenant_id_uq` (`tenant_id`,`id`),
  KEY `notif_evento_idx` (`tenant_id`,`codigo_evento`),
  CONSTRAINT `notif_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `notif_tpl_fk` FOREIGN KEY (`tenant_id`,`template_id`) REFERENCES `notificacion_templates` (`tenant_id`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `notif_actor_fk` FOREIGN KEY (`tenant_id`,`creada_por`) REFERENCES `users` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE `notificacion_destinatarios` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint unsigned NOT NULL,
  `notificacion_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NULL,
  `proveedor_id` bigint unsigned NULL,
  `email` varchar(320) NOT NULL,
  `delivery_status` enum('PENDIENTE','ENVIADO','ENTREGADO','FALLIDO','ACKNOWLEDGED') NOT NULL DEFAULT 'PENDIENTE',
  `acknowledged_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `notif_dest_tenant_id_uq` (`tenant_id`,`id`),
  KEY `notif_dest_notif_idx` (`tenant_id`,`notificacion_id`),
  CONSTRAINT `notif_dest_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `notif_dest_notif_fk` FOREIGN KEY (`tenant_id`,`notificacion_id`) REFERENCES `notificaciones` (`tenant_id`,`id`) ON DELETE RESTRICT
) ENGINE=InnoDB;
