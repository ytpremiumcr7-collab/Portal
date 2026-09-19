# Piedra Angular — Architecture (public procurement portal + Domain Authority + audit harden)

## Boundary (ARES only)

Product brand: **Piedra Angular**. Codebase/package boundary remains ARES-only (no Megalodon/BIM/APU).

Piedra Angular is Mexico’s **transactional public procurement** platform: planeación → investigación de mercado → convocatoria → aclaraciones → recepción/apertura → evaluación → dictamen → fallo → acto de adjudicación → adjudicación → contrato → garantías → ejecución → pagos → incidencias / sanciones / inconformidades, con notificaciones oficiales y consulta pública.

**Out of scope / never merge here:** Megalodon, BIM, APU, or any “preparation platform” features. MEGALODON prepares; Piedra Angular contracts, administers, and governs.

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
- SMTP outbox: `ARES_SMTP_URL` (webhook/smtp/smtps) **or** discrete `SMTP_HOST/PORT/USER/PASS/FROM`. TLS + timeouts. Unset → `REGISTRADA`. Accept → `ENVIADA_EXTERNA` + provider messageId. Worker: `npm run outbox:worker` with lease reclaim.

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
7. **SMTP/outbox** — adapter: webhook or nodemailer when `ARES_SMTP_URL` set; else `REGISTRADA`
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
3. Full SMS provider; richer multi-tenant SMTP credentials UI
4. Multi-regime depth (state/municipal overlays beyond LAASSP/LOPSRM seeds)
5. Hash-chain on `audit_log` (today chain lives on expediente events)

*(OCDS export: landed as public projection MVP.)*

## Stack

Drizzle (MySQL/MariaDB) + tRPC + React. Spanish domain terms. ARES-only codebase (product: Piedra Angular) — no Megalodon.


## Pre-producción (0012+)

- `audit_log` hash-chain (`previous_hash` / `event_hash`) in `writeAudit`, same spirit as expediente events
- UI modules: acto de adjudicación, comisión/COI, cancelación/desierto, calendario jurídico, garantías BESA, consorcios MVP
- Consorcios: tablas + vínculo a participación/proposición
- Brand constant: `PRODUCT_NAME` in `src/const.ts` (= "Piedra Angular")

## Pre-prod P0/P1 (0013) — procedure integrity

| # | Fix |
|---|-----|
| P0-1 | `sorteo_documentado`: never silent `id` fallback; `actos_desempate` emit/register; ranking/adjudicar consume resultado |
| P0-2 | Sobre económico sellado: `montoOferta` redacted in participaciones list/get until apertura ABIERTA/PUBLICADA |
| P0-3 | Admin no longer auto-all capabilities / adminBypass; `break_glass` time-bound grant + expediente + audit |
| P0-4 | Recepción: calendario `ventana_fin` ms; deadline+1ms REJECT; require RECEPCION window when published |
| P1-5 | `audit_chain_heads` FOR UPDATE serializes audit hash chain |
| P1-6 | Hot paths: create participación / evaluar writeAudit in same TX |
| P1-7 | Outbox: claimedAt/claimedBy/lease reclaim; idempotencyKey; system actor sentinel (never invent user id=1) |
| P1-8 | capabilityQuery + assertProcedimientoAsignacion: publicar, apertura, actoAdjudicacion, formalizar/rescindir, comision.designar |
| P1-9 | Consorcios: proveedor owns create/add/activate; convocante validates/links only |
| P1-10 | `participaciones.delete` → RETIRADA/INVALIDADA (no hard delete) |

### SMTP producción
- `ARES_SMTP_URL` (`smtp://`, `smtps://`, or `https://` webhook) **or** discrete `SMTP_HOST/PORT/USER/PASS/FROM`
- TLS min 1.2, timeouts, structured logs; `ENVIADA_EXTERNA` only on accept; stores `providerMessageId`
- `npm run outbox:once` / `npm run outbox:worker` (lease reclaim loop)

### UI proveedor
- `/oportunidades`, `/presentar-propuesta`, `/mis-proposiciones`, documentos/comunicaciones

## Pre-prod residual (0014) — envelope encryption + system actor + authz

| # | Fix |
|---|-----|
| R-1 | `sobres_economicos`: AES-256-GCM ciphertext/nonce/authTag/keyVersion; `montoOferta` placeholder until apertura `abrir`/`registrarOfertas` reveal |
| R-2 | Key rotation stub: `ARES_ENVELOPE_KEY` + `ARES_ENVELOPE_KEY_VERSION` + `ARES_ENVELOPE_KEY_V{n}` |
| R-3 | `ensureSystemActor(tenantId)` → `system+t{id}@piedra-angular.local` (password null, activo=0); outbox never invents userId=1 |
| R-4 | Audit chain concurrency: `audit_chain_heads` FOR UPDATE under stress keeps `verifyAuditHashChain` true |
| R-5 | Remaining procedural mutations off bare `convocanteQuery` → `capabilityQuery` / `adminQuery` (config) |
| R-6 | Canonical calendar reception: ms `ventana_fin` only — day-only `fechaCierre` path DELETED (see Autoridad canónica de tiempo) |


## Autoridad canónica de tiempo

**Canonical reception time = published calendar `ventana_inicio` / `ventana_fin` only (ms).**  
NEVER reunite with day-granularity `fechaCierre` as a second clock for recepción.

| Clock | Authority |
|-------|-----------|
| Recepción / proposición | `calendario_actos` acto=`RECEPCION` (`assertRecepcionDentroDeVentana`) |
| Evaluación / adjudicación windows | `calendario_actos` via `assertCalendarioPermite` when row present |
| `fechaCierre` / `fechaPublicacion` / `fechaApertura` | Planning / OCDS / publish readiness only — **not** recepción deadline |

Domain contract for a published procedimiento:

```
procedimiento (licitación)
  + ProcedurePolicy snapshot (frozen at publish)
  + calendario jurídico (RECEPCION required to accept offers)
```

If code still compares `fechaCierre` day strings (`slice(0,10)`, EOD UTC) for recepción → **DELETE that path**.

## Pre-prod residual close-out (0014+/0015 ops)

| # | Fix |
|---|-----|
| T-1 | Dual-clock deleted: no `fechaCierre_eod` fallback in reception gates |
| T-2 | Legacy plaintext migrate: `migrateLegacyPlaintextMontos` / `scripts/migrate-legacy-sobres.ts` — encrypt+placeholder when `ARES_ENVELOPE_KEY` set; else flag and block convocante reads |
| T-3 | `ensureSystemActorsForAllTenants` on seed (all existing tenants, not only first outbox) |
| T-4 | `sod.bootstrapAsignaciones` one-shot → only `creador` (not all roles); operational acts need `procedimiento_asignaciones` / explicit caps |
| T-5 | Licitante ROLE defaults stay narrow — no restore of all procedural capabilities |

### Capability grants (ops note)

Convocante **operational** roles (`evaluar_*`, `autorizar_fallo`, `aprobar_pago`, …) require:

1. Explicit `user_capabilities` grants where needed beyond `ROLE_CAPABILITIES.licitante`, **and**
2. `procedimiento_asignaciones` on the specific licitación (or time-bound `break_glass`).

Admin does **not** auto-bypass SoD. Use `sod.bootstrapAsignaciones` only to seed `creador` on a new empty procedimiento.



## Uniform procedure authority (0015)

Juridical acts **cannot** run on global capability alone.

```
procedureMutation({ capability, role|roles[], resolveLicitacionId })
  1. authenticated
  2. tenant (ctx.user.tenantId)
  3. assertCapability
  4. assertProcedimientoAsignacion OR active APPROVED break_glass
     (approvedBy ≠ beneficiary — second person)
  5. optional assertCapabilityCompatibility
```

| Domain | Guard |
|--------|-------|
| licitaciones.publicar / iniciarEvaluacion / adjudicar | procedureMutation + creador / evaluador_* / autorizador_fallo |
| participaciones.evaluar | procedureMutation + evaluar_tecnico\|evaluar_economico + evaluador_tecnico\|evaluador_economico |
| aperturas.* | procedureMutation + creador |
| contratos.crear / ponerVigente / terminar / configurarBesa / formalizar / rescindir | procedureMutation + creador |
| garantias transitions | procedureMutation + creador |
| terminacion.crear / publicar | procedureMutation + creador (capability `publicar`) |
| calendario.configurar | administrar_calendario **or** crear_procedimiento+creador; freeze after PUBLICADA except break_glass |
| ejecucion.* | procedureMutation + administrar_ejecucion\|creador |
| inconformidades.transicionar | procedureMutation + resolver_inconformidad |
| dictamenes / fallos / actoAdjudicacion / comision / pagos / desempate | procedureMutation (universal) |

### Break-glass & grants — second person
- `requestBreakGlass` → `approveBreakGlass` (preferred); `grantBreakGlass` only with `approvedBy` ≠ requester ≠ beneficiary
- Self `grantBreakGlass` / self-grant of procedural capabilities **FORBIDDEN** without second approver
- `sod.asignar` self-assign of sensitive roles requires `approvedBy`
- Override metadata persisted on `user_capabilities` / `procedimiento_asignaciones`

### Envelope AAD + seal without decrypt
- AES-GCM AAD = `tenantId:licitacionId:participacionId:proposicionId:keyVersion`
- Manifest/seal uses **ciphertext hash** (not decrypted monto); decrypt only on apertura reveal

### Outbox
- Fail-closed if no system actor for legal-effect events (`FAILED` / stay `PENDING`, never `SENT`)
- Webhook `Idempotency-Key` = outbox id; `delivery_attempts` JSON; SMTP is **at-least-once**

Migration: **`0015_procedure_authority.sql`**.




## P1 audit close-out (0017) — residual after cfaeee5 / 38d82c9

| ID | Fix |
|----|-----|
| P1-1 | Calendario versionado: `calendario_versiones` append-only + expediente event; projection update with motivo/changedBy/approvedBy/breakGlass |
| P1-2 | Hitos: `anular` → ANULADO + motivo (no `db.delete`) |
| P1-3 | Evidence binding: terminacion + desempate use `assertDocumentoBoundToContext` + FKs |
| P1-4 | `verifyDocumentStoreIntegrity` (storage bytes ↔ sha256) via expedientes/auditoria |
| P1-5 | MIME magic-bytes detect + allowlist; download `X-Content-Type-Options: nosniff` |
| P1-6 | Login rate limit per IP + account with progressive lockout; MFA/step-up documented as next |
| P1-7 | Atomic audit: critical paths pass `tx` into `writeAudit` |
| P1-8 | Removed throwing stubs `capabilities.grant` / `sod.asignar`; UI uses request/approve |
| UI-9 | Capabilities admin + SoD request/approve |
| UI-10 | Desempate page → emitir/registrarResultado |
| UI-11 | Planeacion UI: programas, partidas, suficiencia, estrategia, vincular |
| UI-12 | InvestigacionMercado UI: cotizaciones, validar/descartar, comparativo, concluir |
| UI-13 | Public: PAAASOP/programas + investigación concluida; downloads `/api/public/documents/:id` |
| UI-14 | Proveedor `retirar` vs admin `invalidar` (separate mutations) |
| INF-15 | GitHub Actions CI: install, tsc, test, static (+ optional MariaDB) |
| INF-16 | `EnvelopeKeyProvider` (Env default + AwsKms/Vault stubs) |
| INF-17 | `firmas_electronicas` + dictamen.firmar SESSION_CONFIRMATION (honest; not e.firma avanzada) |
| INF-18 | SMTP tenant settings UI + outbox list |

### Residuals (intentionally open)
1. True e.firma / FIEL provider (qualified certificate)
2. Real KMS/HSM credentials (AwsKms/Vault stubs only)
3. Full Compras MX parity modules beyond current cores

Migration: **`0017_audit_p1_closeout.sql`**.

## Residual risks (intentionally open)

1. **HSM / KMS for envelope keys** — EnvKeyProvider default; AwsKms/Vault stubs exist but need real credentials (AES-256-GCM software). Production should move active keys to HSM/KMS with app-level unwrap; rotation stub (`ARES_ENVELOPE_KEY_V{n}`) remains software-side until then.
2. E-signature (advanced / qualified / FIEL) — structure via firmas_electronicas (SESSION_CONFIRMATION / CRYPTO_SIGNATURE); true FIEL provider still deferred.
3. Full multi-tenant SMTP password vaulting — UI host/from/status + outbox landed; secret material remains env/worker-side.

