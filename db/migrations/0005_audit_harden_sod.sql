-- Audit harden: stub SoD incompatibilities table (policy rows optional; empty = no enforcement).
-- presentar_pago is a catalog capability (varchar) — no DDL required for it.

CREATE TABLE IF NOT EXISTS `capability_incompatibilidades` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `capability_a` varchar(64) NOT NULL,
  `capability_b` varchar(64) NOT NULL,
  `motivo` text,
  `activa` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cap_incomp_pair_uq` (`capability_a`,`capability_b`)
) ENGINE=InnoDB;
