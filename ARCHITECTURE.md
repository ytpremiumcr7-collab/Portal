# ARES Engine MX — Architecture (Phase 3 + P1 harden + SoD)

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
2. **Finiquito**: before `emitirFiniquito` — no open critical incidencias; no pending estimaciones; no pending entregables; paid cumulative reconciles vs contrato; garantías not in REQUERIDA/PRESENTADA (`api/lib/finiquito-gates.ts`).
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

Migrations: `0004_phase3_ciclo_completo.sql`, `0005_audit_harden_sod.sql`, `0006_sod_procedimiento.sql`.

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

## Stack

Drizzle (MySQL) + tRPC + React. Spanish domain terms. ARES only — no Megalodon.
