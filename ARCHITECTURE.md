# ARES Engine MX — Architecture (Phase 3 — ciclo completo)

## Boundary (ARES only)

ARES is Mexico’s **transactional public procurement** platform: planeación → investigación de mercado → convocatoria → aclaraciones → recepción/apertura → evaluación → dictamen → fallo → adjudicación → contrato → garantías → ejecución → pagos → incidencias / sanciones / inconformidades, con notificaciones oficiales y consulta pública.

**Out of scope / never merge here:** Megalodon, BIM, APU, or any “preparation platform” features. MEGALODON prepares; ARES contracts, administers, and governs.

Design rule: do **not** fake missing phases with more `hitos`, `tipo_documento`, or fields on `licitaciones`. Each act is a real transactional domain (identity, states, transitions, actors, deadlines, evidence, permissions, link to expediente).

**ALERTA ≠ SANCIÓN.** `alertas_seguridad` are risk signals. `sanciones` / `proveedores_impedidos` are legal acts with vigencia that gate participación and adjudicación.

## Conserved from Phase 1–2

- Expediente electrónico gobernado + hash-chain events
- Document versioning; publication gates
- Phase 2: Aclaraciones, Apertura, Dictamen, Fallo, Contratos, Garantías
- Adjudicación requires dictamen APROBADO + fallo PUBLICADO
- Soft-delete `tenants.deleted_at`; ON DELETE RESTRICT on evidence tables

## Phase 3 domains

| Domain | Tables | Key workflow |
|--------|--------|--------------|
| **Planeación** | `programas_anuales`, `partidas_presupuestarias`, `necesidades`, `suficiencias_presupuestarias`, `estrategias_procedimiento` | necesidad BORRADOR→…→APROBADA; suficiencia OTORGADA; estrategia; **vincularALicitacion** creates procedimiento without collapsing planning into `licitaciones` |
| **Inv. mercado** | `investigaciones_mercado`, `proveedores_consultados`, `cotizaciones_mercado` | Distinct from participación/oferta; comparativo → conclusion |
| **Procedimiento** | `procedimiento_eventos`, `procedimiento_plazos` | Legal-operational enrichment + deadlines (Phase 2 domains untouched) |
| **Ejecución** | `modificaciones_contractuales`, `ejecuciones_contractuales`, `entregables`, `finiquitos` | Convenios/ampliaciones/prórrogas; avance; aceptación; finiquito — expediente events in same TX |
| **Pagos** | `estimaciones_pago` | PRESENTADA→EN_REVISION→AUTORIZADA→PAGADA \| RECHAZADA (not just FACTURA doc) |
| **Incidencias** | `incidencias` | ABIERTA→…→RESUELTA/CERRADA; acción correctiva |
| **Sanciones** | `investigaciones_sancion`, `sanciones`, `proveedores_impedidos` | tipo/fundamento/autoridad/vigencia; gates on participate/adjudicar |
| **Inconformidades** | `inconformidades` | promovente, acto, plazos, resolución |
| **Notificaciones** | `notificacion_templates`, `notificaciones`, `notificacion_destinatarios` | delivery_status + acknowledgement; hooks for fallo/adjudicación/contrato/sanción/inconformidad |
| **Consulta pública** | (reads existing) | `consultaPublica.*` via `publicQuery` — no admin auth |
| **RBAC capabilities** | `user_capabilities` | capability-based beyond admin/licitante/proveedor |

### Capability catalog

`crear_procedimiento`, `publicar`, `evaluar_tecnico`, `evaluar_economico`, `aprobar_juridico`, `emitir_dictamen`, `autorizar_fallo`, `formalizar_contrato`, `aprobar_pago`, `resolver_incidencia`, `administrar_sancion`, `auditar`, `administrar_planeacion`, `investigar_mercado`, `administrar_ejecucion`, `resolver_inconformidad`, `notificar`, `consulta_publica_admin`.

Role defaults in `api/lib/capabilities.ts`; overrides in `user_capabilities`. Middleware: `capabilityQuery(...)`.

### Public consult

Unauthenticated router `consultaPublica` (registered in `api/router.ts`):

- `procedimientos`, `adjudicaciones`, `contratos`, `sancionados`, `documentosPublicos`, `resumen`
- UI: `/consulta-publica` (outside AppLayout auth gate)

### Integrity

- Material acts + `expediente_events` (+ audit) in **same transaction** where an expediente exists
- Soft-delete / RESTRICT on evidence; no CASCADE wipe of history for tenant delete
- Alert → optional `investigaciones_sancion` stub linking to sanción

### Routers (Phase 3)

`planeacion`, `investigacionMercado`, `procedimiento`, `ejecucion`, `pagos`, `incidencias`, `sanciones`, `inconformidades`, `notificaciones`, `consultaPublica`, `capabilities`.

Migration: `db/migrations/0004_phase3_ciclo_completo.sql`.

Transition guards: `api/lib/phase2-transitions.ts` + `api/lib/phase3-transitions.ts` (vitest, no live DB).

## Sequence (full cycle)

```
PLANEACIÓN → (inv. mercado) → PROCEDIMIENTO → ACLARACIONES → APERTURA
→ EVALUACIÓN → DICTAMEN → FALLO → ADJUDICACIÓN → CONTRATO → GARANTÍAS
→ EJECUCIÓN / MODIFICACIONES → PAGOS → FINIQUITO
(+ incidencias / sanciones / inconformidades / notificaciones)
```

## TODOs (light stubs / future)

- Hash-chain on `audit_log` (today chain lives on expediente events)
- Full out-of-band email/SMS delivery adapters (status machine is real; transport is in-process mark-as-sent)
- Finer UI for capability assignment beyond admin API `capabilities.grant`

## Stack

Drizzle (MySQL) + tRPC + React. Spanish domain terms. ARES only — no Megalodon.
