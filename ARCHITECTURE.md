# ARES Engine MX — Architecture (Governmental portal + Domain Authority + audit harden)

## Boundary (ARES only)

ARES is Mexico’s **transactional public procurement** platform: planeación → investigación de mercado → convocatoria → aclaraciones → recepción/apertura → evaluación → dictamen → fallo → acto de adjudicación → adjudicación → contrato → garantías → ejecución → pagos → incidencias / sanciones / inconformidades, con notificaciones oficiales y consulta pública.

**Out of scope / never merge here:** Megalodon, BIM, APU, or any “preparation platform” features. MEGALODON prepares; ARES contracts, administers, and governs.

Design rule: do **not** fake missing phases with more `hitos`, `tipo_documento`, or fields on `licitaciones`. Each act is a real transactional domain.

**ALERTA ≠ SANCIÓN.** `alertas_seguridad` are risk signals. `sanciones` / `proveedores_impedidos` are legal acts with vigencia that gate participación and adjudicación.

## Information architecture (four worlds)

1. **Portal público** (unauthenticated): `/portal`, `/convocatorias`, `/licitaciones-publicas`, `/buscador`, `/consulta-publica`, OCDS (`consultaPublica.ocdsRelease`)
2. **Área licitante/proveedor**: oportunidades, proposición/documentos, comunicaciones
3. **Área dependencia**: crear procedimiento → evaluación → junta → fallo → acto adjudicación → contrato → ejecución
4. **Auditoría**: expedientes, evidencias, bitácora, SoD

UX: **light formal governmental** theme (white/off-white, deep navy headers, restrained green/red status). Spanish es-MX copy. No dark SaaS look.

## No-demo / production policy

- There is **no runtime “demo mode”** and no `DEMO_*` feature flags.
- `db/seed.ts` is an **ops bootstrap tool** only (initial tenant/admin for empty DBs), not a product identity.
- Public `auth.register` org self-serve:
  - **production** (`NODE_ENV=production`): disabled unless `ARES_ALLOW_PUBLIC_REGISTER=true`
  - **development**: allowed unless `ARES_ALLOW_PUBLIC_REGISTER=false`
- Default production posture: `ARES_ALLOW_PUBLIC_REGISTER=false`.
- IP: trust `X-Forwarded-For` only when `ARES_TRUST_PROXY=true`; otherwise direct/socket.
- SMTP outbox: `ARES_SMTP_URL` + adapter `smtp` can mark `ENVIADA_EXTERNA`; otherwise notifications remain `REGISTRADA`.

## Conserved from Phase 1–2 / Phase 3 ciclo completo / P1 / SoD / Domain Authority

- Expediente electrónico gobernado + hash-chain events
- Document versioning; publication gates
- Phase 2–3 transactional domains
- Adjudicación requires dictamen APROBADO + fallo PUBLICADO + **acto_adjudicacion PUBLICADO**
- Soft-delete `tenants.deleted_at`; ON DELETE RESTRICT on evidence tables
- Finiquito only via `emitirFiniquito`; evaluation freeze at publish
- ProcedurePolicy + Proposición + domain outbox

## Audit harden (0011) — closed

| # | Fix |
|---|-----|
| P0-1 | Publish selects ProcedurePolicy by **modalidad + régime** (OBRA→LOPSRM else LAASSP), **highest version**; fail if none |
| P0-2 | `registrarOfertas` / completeness use sealed `proposicion_documentos`; seal+apertura same TX; eval/adjudicación sync proposición estados |
| P1-3 | `assertActosPermitidosPorPolitica` compares policy vs configured hitos |
| P1-4 | `policyId` required at publish (NOT NULL) |
| P1-5 | Honor `requisitos.garantiaSeriedad` in proposición completeness |
| P1-6 | Junta only if policy actos include `JUNTA_ACLARACIONES` |
| P1-7 | Authoritative `recibidoAt` on participación/proposición create; passed into ranking/adjudicar |
| P1-8 | Outbox worker aborts claim when `affectedRows===0` |
| P1-9 | Notification parent `ACKNOWLEDGED` only when all destinatarios ack; else `PARCIAL` |
| P1-10 | Rescisión → `CONTRATO_RESCINDIDO` |
| P1-11 | `documentos.cambiarEstado` update + expediente event same TX |
| P1-12 | SoD capability check **fail-closed** on infra errors |
| P1-13 | Atomic proveedor participation counter (same TX) |
| P1-14 | IP trust proxy gated by `ARES_TRUST_PROXY` |
| P1-15 | Market quotes comparativo **only VALIDADA**; validate/discard transitions |
| P1-16 | Incidencias aggregate consistency + `asignadaA` FK |

## Ten governmental points (MVP)

1. **acto_adjudicacion** — ranking proposal + authority decision + publish gate; adjudicación requires published act
2. **Comisión evaluadora + COI** — members + declarations; evaluar blocked if COI without recusal
3. **Cancelación / desierto** — `actos_terminacion` with causa/fundamento/documento + outbox
4. **BESA-lite** — garantía types + `%` / póliza; `penas_convencionales` + `administrador_contrato` on contract
5. **Calendario jurídico** — `calendario_actos` windows gate RECEPCION / EVALUACION / ADJUDICACION when present
6. **OCDS-like** — `consultaPublica.ocdsRelease` planning/tender/award/contract JSON
7. **SMTP/outbox** — stub adapter marks `ENVIADA_EXTERNA` when `ARES_SMTP_URL` set
8. **CUCoP-lite** — `catalogo_cucop` + link on licitación; seed codes
9. **Modalities** — IR/AD skip junta via policy actos (#6)
10. **Adversarial tests** — `api/lib/gov-audit.test.ts` (+ institutional cores)

## Domain Authority

```
LegalRegime (LAASSP / LOPSRM)
    └─ ProcedurePolicy (modalidad + version + hash) — highest version at publish
           └─ freeze → licitacion_reglas_version (policyId required)
                  ├─ evaluation / adjudicación / dictamen / fallo READ snapshot only
                  └─ tieBreakPolicy: precio | fechaRecepcion | sorteo_documentado

Participación (recibidoAt) + docs → Proposición (manifestHash / sealHash)
    └─ aperturas.sellar seals proposición manifests in same TX as apertura SELLADA
           └─ registrarOfertas reads proposicion_documentos (not live documentos bag)

Critical acts → domain_outbox → notificaciones REGISTRADA
    └─ ENVIADA_EXTERNA only if adapter reports external success (SMTP stub when URL set)
```

Migrations: `0008`–`0010` + **`0011_audit_harden.sql`**.

### Deferred — remaining institutional cores
1. E-signature (advanced / qualified)
2. Consorcios / joint ventures
3. Full production SMTP/SMS provider beyond stub
4. Multi-regime depth (state/municipal overlays beyond LAASSP/LOPSRM seeds)
5. Hash-chain on `audit_log` (today chain lives on expediente events)

*(OCDS export: landed as public projection MVP.)*

## Stack

Drizzle (MySQL/MariaDB) + tRPC + React. Spanish domain terms. ARES only — no Megalodon.
