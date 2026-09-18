# ARES Engine MX — Architecture (Phase 2)

## Boundary (ARES only)

ARES is Mexico’s **transactional public procurement** platform: convocatoria → aclaraciones → recepción/apertura → evaluación → dictamen → fallo → adjudicación → contrato → garantías → (future) ejecución/pagos/sanciones.

**Out of scope / never merge here:** Megalodon, BIM, APU, or any “preparation platform” features. MEGALODON prepares; ARES contracts, administers, and governs.

Design rule: do **not** fake missing phases with more `hitos`, `tipo_documento`, or fields on `licitaciones`. Each act is a real transactional domain (identity, states, transitions, actors, deadlines, evidence, permissions, link to expediente).

## Conserved from Phase 1

- Expediente electrónico gobernado (`expedientes`, requirements, hash-chain `expediente_events`)
- Document versioning (`version_group`, `es_version_vigente`)
- Publication gates (expediente APROBADO + docs + junta)
- Evaluación in `participaciones` + integrity alerts
- Tenant isolation filters

## What landed in Phase 2

| Domain | Tables | Key workflow |
|--------|--------|--------------|
| **Aclaraciones** | `aclaraciones_juntas`, `_preguntas`, `_respuestas` | PROGRAMADA → ABIERTA → CERRADA_PREGUNTAS → EN_RESPUESTA → ACTA_EMITIDA → PUBLICADA |
| **Apertura gobernada** | `aperturas`, `apertura_registros` | RECEPCION_ABIERTA → CERRADA → SELLADA → ABIERTA → REGISTRADA → ACTA_EMITIDA → PUBLICADA |
| **Dictamen** | `dictamenes`, `dictamen_firmantes` | BORRADOR (firmas) → EMITIDO → APROBADO \| RECHAZADO |
| **Fallo** | `fallos` | BORRADOR → EMITIDO → APROBADO → PUBLICADO |
| **Contratos** | `contratos` | BORRADOR → FORMALIZADO → VIGENTE → TERMINADO \| RESCINDIDO |
| **Garantías** | `garantias` | REQUERIDA → PRESENTADA → VIGENTE → LIBERADA \| EJECUTADA |

### Sequence wiring

`EVALUACIÓN → DICTAMEN → FALLO → ADJUDICACIÓN → CONTRATO`

- `licitaciones.iniciarEvaluacion` requires apertura **PUBLICADA** (not only `ACTA_APERTURA` document).
- `licitaciones.adjudicar` requires dictamen **APROBADO** + fallo **PUBLICADO** aligned on proveedor/monto (no longer only a DICTAMEN document).
- Material acts append `expediente_events` **in the same DB transaction** as the state change.

### Evidence / tenant delete

- Soft-delete column `tenants.deleted_at`.
- `ON DELETE RESTRICT` for evidentiary aggregates: `expedientes`, `expediente_events`, `audit_log`, and all Phase 2 domain tables (no CASCADE wipe of history).

### Routers

Registered in `api/router.ts`: `aclaraciones`, `aperturas`, `dictamenes`, `fallos`, `contratos`, `garantias`.

UI routes under AppLayout: `/aclaraciones`, `/aperturas`, `/dictamenes`, `/fallos`, `/contratos`, `/garantias`.

Migration: `db/migrations/0003_phase2_dominios_transaccionales.sql`.

## TODOs (next domains — stubs only, not implemented)

- Investigación de mercado (cotizaciones ≠ participación)
- Pagos / administración contractual / modificaciones / ejecución
- Sanciones e investigación (≠ alertas)
- Inconformidades
- Notificaciones oficiales
- Consulta pública
- Segregación de roles más fina (más allá de admin/licitante/proveedor)
- Hash-chain on `audit_log` (today chain lives on expediente events)

## Stack

Drizzle (MySQL) + tRPC + React. Pure transition guards in `api/lib/phase2-transitions.ts` (vitest without live DB).
