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

console.log("governance static assertions: PASS (phase1 + phase2)");
