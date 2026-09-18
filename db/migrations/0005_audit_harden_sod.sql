-- Audit harden: stub SoD incompatibilities table (policy rows optional; empty = no enforcement).
-- presentar_pago is a catalog capability (varchar) — no DDL required for it.

CREATE TABLE IF NOT EXISTS `capability_incompatibilidades` (
  `id` serial AUTO_INCREMENT NOT NULL,
  `capability_a` varchar(64) NOT NULL,
  `capability_b` varchar(64) NOT NULL,
  `motivo` text,
  `activa` boolean NOT NULL DEFAULT true,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `capability_incompatibilidades_id` PRIMARY KEY(`id`),
  CONSTRAINT `cap_incomp_pair_uq` UNIQUE(`capability_a`,`capability_b`)
);
