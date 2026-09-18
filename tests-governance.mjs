import fs from "node:fs";
import path from "node:path";
const files=fs.readdirSync("api/routers").filter(f=>f.endsWith(".ts"));
for(const name of files){
  if(name==="auth-router.ts") continue;
  const text=fs.readFileSync(path.join("api/routers",name),"utf8");
  if(/publicQuery(?:\.input|\s*\n?\s*)[^;\n]*\.mutation/.test(text)) throw new Error(`public mutation detected in ${name}`);
}
const schema=fs.readFileSync("db/schema.ts","utf8");
for(const marker of ["participaciones_tenant_proveedor_fk","licitaciones_tenant_entidad_fk","alerta_tenant_licitacion_fk","documentos_tenant_proveedor_fk","hitos_tenant_licitacion_fk","sessions_user_fk","audit_actor_fk","documentos_tenant_previous_version_fk"]) if(!schema.includes(marker)) throw new Error(`Missing schema constraint: ${marker}`);
if(!schema.includes('export const expedientes')) throw new Error('Missing expediente aggregate schema');
if(!schema.includes('version_group')) throw new Error('Missing document version group');
const routerIndex=fs.readFileSync("api/router.ts","utf8");
if(!routerIndex.includes("expedientesRouter")) throw new Error('Expediente router is not registered');
const domain=fs.readFileSync("api/lib/domain.ts","utf8");
if(!domain.includes('expediente.estado !== "APROBADO"')) throw new Error('Publication is not gated by approved expediente');
if(!domain.includes('findExpedienteByLicitacion')) throw new Error('Domain does not resolve the expediente aggregate');
const docsRouter=fs.readFileSync('api/routers/documentos.ts','utf8');
if(!docsRouter.includes('reemplazaDocumentoId')) throw new Error('Document versioning replacement input missing');
if(!docsRouter.includes('esVersionVigente: false')) throw new Error('Document obsolete transition does not close current version');
const expeditionDomain=fs.readFileSync('api/lib/expediente.ts','utf8');
if(!expeditionDomain.includes('eventSequence')) throw new Error('Expediente event sequence is not concurrency-safe');
if(!expeditionDomain.includes('eventHash')) throw new Error('Expediente evidence hashing missing');

// Phase 2
for (const name of ["aclaraciones","aperturas","dictamenes","fallos","contratos","garantias"]) {
  if (!routerIndex.includes(`${name}Router`) && !routerIndex.includes(`from "./routers/${name}"`)) {
    throw new Error(`Phase 2 router not registered: ${name}`);
  }
}
for (const table of ["aclaracionesJuntas","aperturas","dictamenes","fallos","contratos","garantias"]) {
  if (!schema.includes(`export const ${table}`)) throw new Error(`Missing Phase 2 schema: ${table}`);
}
if (!schema.includes('deletedAt') && !schema.includes('deleted_at')) throw new Error('Tenant soft-delete missing');
if (!schema.includes('"DICTAMEN"') && !schema.includes("'DICTAMEN'")) throw new Error('Licitacion etapa DICTAMEN missing');
if (!schema.includes('"FALLO"') && !schema.includes("'FALLO'")) throw new Error('Licitacion etapa FALLO missing');
const licRouter = fs.readFileSync("api/routers/licitaciones.ts", "utf8");
if (!licRouter.includes("assertAdjudicacionRequiresFallo")) throw new Error("Adjudicación no exige dictamen+fallo");
if (!licRouter.includes("assertEvaluacionRequiresApertura")) throw new Error("Evaluación no exige apertura gobernada");
const mig = fs.readFileSync("db/migrations/0003_phase2_dominios_transaccionales.sql", "utf8");
if (!mig.includes("ON DELETE RESTRICT")) throw new Error("Phase 2 migration missing RESTRICT on evidence FKs");
if (!fs.existsSync("ARCHITECTURE.md")) throw new Error("ARCHITECTURE.md missing");
const arch = fs.readFileSync("ARCHITECTURE.md", "utf8");
if (!arch.includes("ARES only") && !arch.includes("ARES-only") && !arch.toLowerCase().includes("ares only")) {
  if (!arch.includes("Boundary (ARES only)")) throw new Error("ARCHITECTURE.md missing ARES-only boundary");
}
const transitions = fs.readFileSync("api/lib/phase2-transitions.ts", "utf8");
if (!transitions.includes("assertAdjudicacionRequiresFallo")) throw new Error("phase2 transitions missing adjudicacion gate");

// phase1+phase2 checks above; phase3 continues

// Phase 3
const phase3Routers = [
  "planeacion", "investigacionMercado", "procedimiento", "ejecucion", "pagos",
  "incidencias", "sanciones", "inconformidades", "notificaciones", "consultaPublica", "capabilities",
];
for (const name of phase3Routers) {
  if (!routerIndex.includes(`from "./routers/${name}"`) && !routerIndex.includes(`${name}Router`)) {
    throw new Error(`Phase 3 router not registered: ${name}`);
  }
}
for (const table of [
  "necesidades", "programasAnuales", "investigacionesMercado", "cotizacionesMercado",
  "modificacionesContractuales", "ejecucionesContractuales", "estimacionesPago",
  "incidencias", "sanciones", "proveedoresImpedidos", "inconformidades",
  "notificaciones", "userCapabilities", "procedimientoEventos",
]) {
  if (!schema.includes(`export const ${table}`)) throw new Error(`Missing Phase 3 schema: ${table}`);
}
const mig4 = fs.readFileSync("db/migrations/0004_phase3_ciclo_completo.sql", "utf8");
if (!mig4.includes("ON DELETE RESTRICT")) throw new Error("Phase 3 migration missing RESTRICT");
if (!mig4.includes("proveedores_impedidos")) throw new Error("Phase 3 missing proveedores_impedidos");
if (!mig4.includes("estimaciones_pago")) throw new Error("Phase 3 missing estimaciones_pago");
const p3 = fs.readFileSync("api/lib/phase3-transitions.ts", "utf8");
if (!p3.includes("assertProveedorNoImpedido")) throw new Error("Phase 3 missing impedimento gate");
if (!p3.includes("assertEstimacionTransition")) throw new Error("Phase 3 missing estimacion transitions");
const caps = fs.readFileSync("api/lib/capabilities.ts", "utf8");
if (!caps.includes("crear_procedimiento") || !caps.includes("administrar_sancion")) {
  throw new Error("Capability catalog incomplete");
}
const mw = fs.readFileSync("api/middleware.ts", "utf8");
if (!mw.includes("capabilityQuery") && !mw.includes("requireCaps")) throw new Error("Capability middleware missing");
const part = fs.readFileSync("api/routers/participaciones.ts", "utf8");
if (!part.includes("assertProveedorPuedeParticipar")) throw new Error("Participación no bloquea impedidos");
const lic3 = fs.readFileSync("api/routers/licitaciones.ts", "utf8");
if (!lic3.includes("assertProveedorPuedeAdjudicarse")) throw new Error("Adjudicación no bloquea impedidos");
const pub = fs.readFileSync("api/routers/consultaPublica.ts", "utf8");
if (!pub.includes("publicQuery")) throw new Error("Consulta pública must use publicQuery");
if (/publicQuery[\s\S]*\.mutation/.test(pub)) throw new Error("Consulta pública must not expose mutations");
const arch3 = fs.readFileSync("ARCHITECTURE.md", "utf8");
if (!arch3.includes("Phase 3") && !arch3.includes("ciclo completo")) throw new Error("ARCHITECTURE.md missing Phase 3");
if (!arch3.includes("ALERTA") || (!arch3.includes("SANCIÓN") && !arch3.includes("SANCION") && !arch3.includes("sanciones"))) {
  throw new Error("ARCHITECTURE must document ALERTA ≠ SANCIÓN");
}
if (!arch3.includes("ALERTA ≠") && !arch3.includes("ALERTA !=")) {
  throw new Error("ARCHITECTURE must document ALERTA ≠ SANCIÓN explicitly");
}

// P1 harden + SoD (0006)
const mig6 = fs.readFileSync("db/migrations/0006_sod_procedimiento.sql", "utf8");
if (!mig6.includes("procedimiento_asignaciones")) throw new Error("0006 missing procedimiento_asignaciones");
if (!mig6.includes("bigint unsigned")) throw new Error("0006 must use MySQL-valid bigint unsigned");
if (!mig6.includes("capability_incompatibilidades")) throw new Error("0006 must seed capability incompatibilities");
if (!schema.includes("procedimientoAsignaciones")) throw new Error("Missing procedimientoAsignaciones schema");
if (!schema.includes("investigar_sancion")) throw new Error("Missing investigar_sancion capability");
const sodLib = fs.readFileSync("api/lib/sod.ts", "utf8");
if (!sodLib.includes("assertNoRoleConflict")) throw new Error("SoD helpers missing assertNoRoleConflict");
const oferta = fs.readFileSync("api/lib/oferta-completa.ts", "utf8");
if (!oferta.includes("OFERTA_TECNICA")) throw new Error("oferta-completa missing OFERTA_TECNICA");
const fini = fs.readFileSync("api/lib/finiquito-gates.ts", "utf8");
if (!fini.includes("assertFiniquitoGates")) throw new Error("finiquito gates missing");
const caps2 = fs.readFileSync("api/lib/capabilities.ts", "utf8");
{
  const m = caps2.match(/licitante:\s*\[([\s\S]*?)\],\s*\n\s*proveedor:/);
  if (!m) throw new Error("Could not parse licitante ROLE_CAPABILITIES");
  if (m[1].includes("autorizar_fallo") || m[1].includes("aprobar_pago") || m[1].includes("administrar_sancion")) {
    throw new Error("licitante default still grants full ops — tighten base set");
  }
}
const envLib = fs.readFileSync("api/lib/env.ts", "utf8");
if (!envLib.includes("allowPublicRegister")) throw new Error("env missing allowPublicRegister");
const auth = fs.readFileSync("api/auth-router.ts", "utf8");
if (!auth.includes("allowPublicRegister")) throw new Error("auth.register not gated by allowPublicRegister");
const archP1 = fs.readFileSync("ARCHITECTURE.md", "utf8");
if (!archP1.includes("SoD") && !archP1.toLowerCase().includes("segregat")) throw new Error("ARCHITECTURE missing SoD");
if (!archP1.toLowerCase().includes("no-demo") && !archP1.includes("no runtime")) throw new Error("ARCHITECTURE missing no-demo policy");
const localRun = fs.readFileSync("LOCAL_RUN.md", "utf8");
if (/demo stack/i.test(localRun) || /modo demo/i.test(localRun)) throw new Error("LOCAL_RUN still frames product as demo");
if (fs.readdirSync(".").some(f => f.startsWith("DEMO_"))) throw new Error("DEMO_* artifact present");
const routerIdx2 = fs.readFileSync("api/router.ts", "utf8");
if (!routerIdx2.includes("sodRouter")) throw new Error("sod router not registered");

console.log("governance static assertions: PASS (phase1 + phase2 + phase3 + P1/SoD)");

