# ARES Engine MX — Architecture (Phase 3 + P1 harden + SoD + institutional audit tranche)

## Boundary (ARES only)

ARES is Mexico’s **transactional public procurement** platform: planeación → investigación de mercado → convocatoria → aclaraciones → recepción/apertura → evaluación → dictamen → fallo → adjudicación → contrato → garantías → ejecución → pagos → incidencias / sanciones / inconformidades, con notificaciones oficiales y consulta pública.

**Out of scope / never merge here:** Megalodon, BIM, APU, or any “preparation platform” features. MEGALODON prepares; ARES contracts, administers, and governs.

Design rule: do **not** fake missing phases with more `hitos`, `tipo_documento`, or fields on `licitaciones`. Each act is a real transactional domain.

**ALERTA ≠ SANCIÓN.** `alertas_seguridad` are risk signals. `sanciones` / `proveedores_impedidos` are legal acts with vigencia that gate participación and adjudicación.

## No-demo / production policy

- There is **no runtime “demo mode”** and no `DEMO_*` feature flags.
- `db/seed.ts` is an **ops bootstrap tool** only (initial tenant/admin for empty DBs), not a product identity.
- Public `auth.register` org self-serve:
  - **production** (`NODE_ENV=production`): disabled unless `ARES_ALLOW_PUBLIC_REGISTER=true`
  - **development**: allowed unless `ARES_ALLOW_PUBLIC_REGISTER=false`
- Default production posture: `ARES_ALLOW_PUBLIC_REGISTER=false`.

## Conserved from Phase 1–2

- Expediente electrónico gobernado + hash-chain events
- Document versioning; publication gates
- Phase 2: Aclaraciones, Apertura, Dictamen, Fallo, Contratos, Garantías
- Adjudicación requires dictamen APROBADO + fallo PUBLICADO
- Soft-delete `tenants.deleted_at`; ON DELETE RESTRICT on evidence tables

## P1 integrity gates (closed)

1. **Apertura / recepción**: `registrarOfertas` requires complete documental offer (`OFERTA_TECNICA` + `OFERTA_ECONOMICA` APROBADO/vigente). Bare participación ≠ complete proposal (`api/lib/oferta-completa.ts`).
2. **Finiquito**: only `emitirFiniquito()` may set `FINIQUITADA` (after `assertFiniquitoGates`); `transicionarEjecucion` / `assertEjecucionTransition` **reject** `to: FINIQUITADA`. Financial rule: cumulative **montoBruto** (PAGADA) vs `contrato.monto` (post-modificaciones); client `montoFinal` must match that bruto within ε (`api/lib/finiquito-gates.ts`).
3. **Garantías**: present/receive (proveedor or convocante intake) vs validate/activar (convocante). Activar requires monto/vigencia/tipo/documento. `ponerVigente` on contrato requires required garantías VIGENTE when configured.
4. **Contratos**: `formalizar` requires CONTRATO APROBADO/vigente doc; `rescindir` requires causa + resolución (+ optional documento); notify hooks when available.
5. **Sanciones**: investigación ABIERTA → EN_TRAMITE → CERRADA_SIN_SANCION / escalate; sanción from alerta requires `investigacionId` (no free-only autoridad invent).
6. **Impedimentos**: canonical active = vigencia window; `syncImpedimentosActivo` keeps `activo` aligned; gate + consulta pública use the window.

## Segregation of duties (SoD)

### Capability catalog

Includes: `crear_procedimiento`, `publicar`, `evaluar_tecnico`, `evaluar_economico`, `aprobar_juridico`, `emitir_dictamen`, `autorizar_fallo`, `formalizar_contrato`, `presentar_pago`, `aprobar_pago`, `resolver_incidencia`, `investigar_sancion`, `administrar_sancion`, `auditar`, `administrar_planeacion`, `investigar_mercado`, `administrar_ejecucion`, `resolver_inconformidad`, `notificar`, `consulta_publica_admin`.

**Licitante default set is small** (crear/publicar/planeación/mercado/notificar). Extra ops capabilities are granted deliberately via `user_capabilities` or procedure roles.

### Procedure-level assignments

Table `procedimiento_asignaciones` (migration `0006`): roles per licitación (`creador`, `evaluador_tecnico`, `evaluador_economico`, `dictaminador`, `autorizador_fallo`, `presentar_pago`, `aprobar_pago`, `investigar_sancion`, `administrar_sancion`, `promovente`, `resolver_inconformidad`).

Same user cannot hold incompatible roles on the **same** procedimiento unless admin override with justification logged to expediente (`SOD_OVERRIDE_ASIGNACION`).

### Capability incompatibilities

Table `capability_incompatibilidades` seeded with: evaluar↔autorizar_fallo; presentar_pago↔aprobar_pago; investigar_sancion↔administrar_sancion.

Router: `sod.*` (+ UI `/sod`). Grant path: `capabilities.grant` with optional `overrideSod`.

### SoD wired into operations

Helper `assertProcedimientoAsignacion(user, licitacionId, role)` (admin full bypass; non-admin must hold assignment). Enforced on:

- `participaciones.evaluar` → `evaluador_tecnico` | `evaluador_economico`
- `dictamenes.emitir` / `aprobar` → `dictaminador`
- `fallos.aprobar` / `publicar` → `autorizador_fallo`
- `pagos.presentar` → `presentar_pago`; `pagos.autorizar`/`pagar`/… → `aprobar_pago`
- `sanciones` investigar / administrar when `licitacionId` is known (input or via incidencia)

`sod.asignar`: check+insert same TX with `FOR UPDATE`. `sod.revocar`: DELETE + expediente event same TX. Override justification persisted on `justificacion_override` + expediente payload.

## Phase 3 domains

| Domain | Tables | Key workflow |
|--------|--------|--------------|
| **Planeación** | `programas_anuales`, `partidas_presupuestarias`, `necesidades`, … | necesidad → vincularALicitacion |
| **Inv. mercado** | `investigaciones_mercado`, … | Distinct from participación |
| **Ejecución** | `modificaciones_contractuales`, `ejecuciones_contractuales`, `entregables`, `finiquitos` | finiquito gated |
| **Pagos** | `estimaciones_pago` | PRESENTADA→…→PAGADA |
| **Incidencias / Sanciones / Inconformidades / Notificaciones** | … | real transitions |
| **Consulta pública** | reads | search/filter + `procedimientoDetalle` |
| **SoD** | `procedimiento_asignaciones`, `capability_incompatibilidades` | per-procedure + capability pairs |

### Public consult

Unauthenticated `consultaPublica`: `procedimientos` (q/estado), `procedimientoDetalle`, `adjudicaciones`, `contratos`, `sancionados`, `documentosPublicos`, `resumen`.

### Integrity

- Material acts + `expediente_events` in **same transaction** where an expediente exists
- Soft-delete / RESTRICT on evidence

### Routers

`planeacion`, `investigacionMercado`, `procedimiento`, `ejecucion`, `pagos`, `incidencias`, `sanciones`, `inconformidades`, `notificaciones`, `consultaPublica`, `capabilities`, `sod`.

### Evaluation engine (published criterion)

Frozen at publish into `licitacion_reglas_version` (hash of criterio, ponderaciones, modo, tipo, marco). Evaluation and adjudicación **read the frozen version**, not live mutable fields.

| Criterio | Winner / orden de mérito |
|----------|--------------------------|
| `PRECIO_MAS_BAJO` | Min admissible economic offer (tech = pass/fail via ADMISIBLE) — **not** `max(puntajeTotal)` |
| `MEJOR_RELACION_CALIDAD_PRECIO` | Weighted tech+econ total |
| `MEJOR_VALOR_TECNICO` | Primary technical ranking among solvent; econ amount must be positive |

Engine: `api/lib/evaluation-engine.ts`. Pre-dictamen/pre-fallo: all received proposiciones must have final eval status (not PENDIENTE).

Migrations: `0004_phase3_ciclo_completo.sql`, `0005_audit_harden_sod.sql`, `0006_sod_procedimiento.sql`, `0007_evaluation_freeze_doc_fks.sql`.

Transition / gate helpers: `api/lib/phase2-transitions.ts`, `phase3-transitions.ts`, `oferta-completa.ts`, `finiquito-gates.ts`, `garantia-gates.ts`, `sod.ts` (vitest, no live DB).

## Sequence (full cycle)

```
PLANEACIÓN → (inv. mercado) → PROCEDIMIENTO → ACLARACIONES → APERTURA
→ EVALUACIÓN → DICTAMEN → FALLO → ADJUDICACIÓN → CONTRATO → GARANTÍAS
→ EJECUCIÓN / MODIFICACIONES → PAGOS → FINIQUITO
(+ incidencias / sanciones / inconformidades / notificaciones)
```

## TODOs (light)

- Hash-chain on `audit_log` (today chain lives on expediente events)
- Full out-of-band email/SMS delivery adapters (status machine is real; transport is in-process)

## Deferred — next institutional cores (NOT this tranche)

Documented explicitly so they are not mistaken for incomplete work in this harden pass:

1. **Full ProcedurePolicy engine** for all modalities (beyond current frozen reglas snapshot)
2. **Electronic Proposicion aggregate** (rich proposal object beyond participación + docs)
3. **Full apertura manifest object** (structured seal/manifest beyond current apertura flow)
4. **Empate jurídico formal** (tie-break legal procedure)
5. **Consorcios** (joint ventures / consortium bidders)
6. **Conflicto de interés declarations** (structured COI workflow)
7. **OCDS export** (Open Contracting Data Standard)
8. **Real SMTP outbox workers** (may stub `outbox` table + hook `fallo.publicar` to enqueue later; transport not productized here)
9. **E-signature** (advanced electronic / qualified signatures)

Also deferred: deeper document-evidence ontology beyond current FK + context binding.

## Stack

Drizzle (MySQL) + tRPC + React. Spanish domain terms. ARES only — no Megalodon.
