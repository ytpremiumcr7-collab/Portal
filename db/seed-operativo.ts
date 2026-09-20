/**
 * Seed operativo / QA — datos realistas de contratación pública (México).
 * No activa ningún interruptor de demostración de producto. Idempotente por códigos OPS-*.
 *
 *   npx tsx db/seed.ts
 *   npx tsx db/seed-operativo.ts
 *   npm run seed:ops
 */
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { hashPassword } from "../api/lib/security";
import { ensureSystemActor, ensureSystemActorsForAllTenants } from "../api/lib/system-actor";
import { ENVELOPE_PLACEHOLDER_MONTO } from "../api/lib/envelope-crypto";
import { insertSobreEconomico } from "../api/lib/sobre-economico";
import {
  tenants,
  users,
  entidades,
  categorias,
  supplierLegalEntities,
  proveedores,
  licitaciones,
  expedientes,
  participaciones,
  proposiciones,
  sobresEconomicos,
  calendarioActos,
  procedimientoAsignaciones,
  userCapabilities,
  licitacionReglasVersion,
  procedurePolicies,
  hitos,
  aclaracionesJuntas,
  dialogoRondas,
  programasAnuales,
  necesidades,
  investigacionesMercado,
  alertasSeguridad,
  CAPABILITIES,
} from "./schema";

const MARK = "OPS";

function envReq(name: string) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} es requerido.`);
  return v;
}
function daysFromNow(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
function dateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}
function insertId(result: any): number {
  return Number(result[0].insertId);
}

const db = getDb();
const email = envReq("SEED_ADMIN_EMAIL").toLowerCase();
const password = envReq("SEED_ADMIN_PASSWORD");
const tenantName = envReq("SEED_TENANT_NAME");
const tenantRfc = envReq("SEED_TENANT_RFC").toUpperCase();

await ensureSystemActorsForAllTenants(db);

let admin = await db.query.users.findFirst({ where: eq(users.email, email) });
if (!admin) {
  console.log("Seed operativo: creando tenant/admin (bootstrap mínimo)…");
  const slug = `${tenantRfc.toLowerCase()}-${randomUUID().slice(0, 8)}`;
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const tenantId = insertId(await tx.insert(tenants).values({ nombre: tenantName, slug, rfc: tenantRfc }));
    await tx.insert(users).values({
      tenantId,
      unionId: `local:${randomUUID()}`,
      name: "Administrador inicial",
      email,
      passwordHash,
      role: "admin",
    });
    await ensureSystemActor(tx, tenantId);
  });
  admin = await db.query.users.findFirst({ where: eq(users.email, email) });
}
if (!admin) throw new Error("No se resolvió el administrador.");
const tenantId = admin.tenantId;
const adminId = admin.id;
await ensureSystemActor(db, tenantId);
console.log(`Seed operativo: tenant=#${tenantId} admin=#${adminId} (${email})`);

async function ensureCap(cap: string) {
  if (!(CAPABILITIES as readonly string[]).includes(cap)) return;
  const ex = await db.query.userCapabilities.findFirst({
    where: and(eq(userCapabilities.tenantId, tenantId), eq(userCapabilities.userId, adminId), eq(userCapabilities.capability, cap)),
  });
  if (ex) {
    if (!ex.granted) await db.update(userCapabilities).set({ granted: true, grantedBy: adminId }).where(eq(userCapabilities.id, ex.id));
    return;
  }
  await db.insert(userCapabilities).values({
    tenantId, userId: adminId, capability: cap, granted: true, grantedBy: adminId,
    overrideSod: false, justificacion: "Seed operativo / QA",
  });
}

for (const cap of [
  "crear_procedimiento", "publicar", "administrar_planeacion", "investigar_mercado",
  "administrar_calendario", "administrar_ejecucion", "notificar", "consulta_publica_admin",
  "auditar", "aprobar_juridico",
] as const) await ensureCap(cap);

async function ensureAsignacion(licitacionId: number, rol: string) {
  const ex = await db.query.procedimientoAsignaciones.findFirst({
    where: and(
      eq(procedimientoAsignaciones.tenantId, tenantId),
      eq(procedimientoAsignaciones.licitacionId, licitacionId),
      eq(procedimientoAsignaciones.userId, adminId),
      eq(procedimientoAsignaciones.rol, rol),
    ),
  });
  if (ex) return;
  await db.insert(procedimientoAsignaciones).values({
    tenantId, licitacionId, userId: adminId, rol, overrideSod: false, justificacionOverride: null, asignadoPor: adminId,
  });
}

async function ensureLegalEntity(rfc: string, razonSocial: string, tipoPersona: "PERSONA_FISICA" | "PERSONA_MORAL") {
  const found = await db.query.supplierLegalEntities.findFirst({ where: eq(supplierLegalEntities.rfc, rfc) });
  if (found) return found.id;
  return insertId(await db.insert(supplierLegalEntities).values({ rfc, razonSocial, tipoPersona }));
}

let entidad = await db.query.entidades.findFirst({
  where: and(eq(entidades.tenantId, tenantId), eq(entidades.rfc, "SAF850101XX1")),
});
if (!entidad) {
  const id = insertId(await db.insert(entidades).values({
    tenantId,
    razonSocial: "Secretaría de Administración y Finanzas (seed operativo)",
    nombreFantasia: "SAF",
    tipoEntidad: "ESTATAL",
    rfc: "SAF850101XX1",
    ciudad: "Ciudad de México",
    estado: "CDMX",
    email: "contrataciones@saf.example.gob.mx",
    telefono: "5550001000",
    representanteLegal: "Mtra. Laura Hernández Ruiz",
    activa: true,
    verificada: true,
  }));
  entidad = await db.query.entidades.findFirst({ where: eq(entidades.id, id) });
}
const entidadId = entidad!.id;

let categoria = await db.query.categorias.findFirst({
  where: and(eq(categorias.tenantId, tenantId), eq(categorias.codigo, `${MARK}-BIENES`)),
});
if (!categoria) {
  const id = insertId(await db.insert(categorias).values({
    tenantId, codigo: `${MARK}-BIENES`, nombre: "Bienes de uso general",
    descripcion: "Categoría de arranque operativo / QA", tipo: "BIENES", activa: true,
  }));
  categoria = await db.query.categorias.findFirst({ where: eq(categorias.id, id) });
}
const categoriaId = categoria!.id;

const proveedoresSeed = [
  { rfc: "TCM850101AB2", razon: "Tecnologías de Cómputo Mexicana S.A. de C.V.", tipo: "PERSONA_MORAL" as const, rubro: "Tecnologías de la información", email: "contacto@tcm-ops.example", ciudad: "Guadalajara", estado: "Jalisco" },
  { rfc: "SGI920315XY9", razon: "Servicios Generales Integrales del Centro S.A. de C.V.", tipo: "PERSONA_MORAL" as const, rubro: "Servicios generales", email: "licitaciones@sgi-ops.example", ciudad: "Puebla", estado: "Puebla" },
  { rfc: "CPS980212JK3", razon: "Constructora y Proyectos del Sur S.A. de C.V.", tipo: "PERSONA_MORAL" as const, rubro: "Obra pública", email: "propuestas@cps-ops.example", ciudad: "Mérida", estado: "Yucatán" },
  { rfc: "GARC850101HD9", razon: "Juan Carlos García Ramírez", tipo: "PERSONA_FISICA" as const, rubro: "Consultoría", email: "jc.garcia@ops-pf.example", ciudad: "Monterrey", estado: "Nuevo León" },
];

const proveedorIds: number[] = [];
for (const p of proveedoresSeed) {
  let row = await db.query.proveedores.findFirst({ where: and(eq(proveedores.tenantId, tenantId), eq(proveedores.rfc, p.rfc)) });
  if (!row) {
    const legalEntityId = await ensureLegalEntity(p.rfc, p.razon, p.tipo);
    const id = insertId(await db.insert(proveedores).values({
      tenantId,
      legalEntityId,
      razonSocial: p.razon,
      rfc: p.rfc,
      tipoProveedor: p.tipo,
      rubroPrincipal: p.rubro,
      ciudad: p.ciudad,
      estado: p.estado,
      email: p.email,
      telefono: "5551002000",
      representanteLegal: p.tipo === "PERSONA_FISICA" ? p.razon : "Apoderado legal (seed)",
      empleadosCantidad: p.tipo === "PERSONA_FISICA" ? 1 : 120,
      facturacionAnual: p.tipo === "PERSONA_FISICA" ? "2500000.00" : "85000000.00",
      estadoVerificacion: "VERIFICADO",
      activo: true,
      licitacionesParticipadas: 3,
      licitacionesGanadas: 1,
      montoTotalAdjudicado: "1500000.00",
      calificacionHistorica: "8.50",
    }));
    row = await db.query.proveedores.findFirst({ where: eq(proveedores.id, id) });
  } else if (row.estadoVerificacion !== "VERIFICADO") {
    await db.update(proveedores).set({ estadoVerificacion: "VERIFICADO", activo: true }).where(eq(proveedores.id, row.id));
  }
  proveedorIds.push(row!.id);
}
console.log(`Proveedores OPS: ${proveedorIds.join(", ")}`);

async function loadPolicy(modalidad: string) {
  const rows = await db.select().from(procedurePolicies).where(eq(procedurePolicies.modalidad, modalidad as any));
  const pol = rows.sort((a, b) => a.id - b.id)[0];
  if (!pol) throw new Error(`Falta procedure_policy para ${modalidad}`);
  return pol;
}

async function freezePolicy(licitacionId: number, tipoLicitacion: string, tipoContratacion: string, policy: any) {
  const ex = await db.query.licitacionReglasVersion.findFirst({
    where: and(eq(licitacionReglasVersion.tenantId, tenantId), eq(licitacionReglasVersion.licitacionId, licitacionId), eq(licitacionReglasVersion.version, 1)),
  });
  if (ex) return;
  const payload = {
    criterioEvaluacion: "MEJOR_RELACION_CALIDAD_PRECIO",
    ponderacionTecnica: "40.00",
    ponderacionEconomica: "60.00",
    modoEvaluacion: "HIBRIDA",
    tipoLicitacion,
    tipoContratacion,
    marcoJuridico: "LAASSP",
    rubricaTecnica: null as string | null,
  };
  const reglasHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  await db.insert(licitacionReglasVersion).values({
    tenantId,
    licitacionId,
    version: 1,
    criterioEvaluacion: payload.criterioEvaluacion,
    ponderacionTecnica: payload.ponderacionTecnica,
    ponderacionEconomica: payload.ponderacionEconomica,
    modoEvaluacion: payload.modoEvaluacion,
    tipoLicitacion,
    tipoContratacion,
    marcoJuridico: "LAASSP",
    rubricaTecnica: null,
    reglasHash,
    policyId: policy.id,
    policyHash: policy.hash,
    tieBreakPolicy: policy.tieBreakPolicy,
    actosObligatorios: policy.actosObligatorios,
    requisitos: policy.requisitos,
    publishedBy: adminId,
  });
}

async function ensureCalendario(licitacionId: number, actos: Array<{ acto: string; start: Date; end: Date }>) {
  for (const a of actos) {
    const ex = await db.query.calendarioActos.findFirst({
      where: and(eq(calendarioActos.tenantId, tenantId), eq(calendarioActos.licitacionId, licitacionId), eq(calendarioActos.acto, a.acto)),
    });
    if (ex) continue;
    await db.insert(calendarioActos).values({
      tenantId, licitacionId, acto: a.acto, ventanaInicio: a.start, ventanaFin: a.end, obligatorio: true,
    });
  }
}

async function ensureHito(expedienteId: number, licitacionId: number, tipo: any, nombre: string, when: Date, estado: "PENDIENTE" | "EN_PROGRESO" | "COMPLETADO") {
  const rows = await db.query.hitos.findMany({ where: and(eq(hitos.tenantId, tenantId), eq(hitos.licitacionId, licitacionId)) });
  if (rows.some((h) => h.tipo === tipo && h.nombre === nombre)) return;
  await db.insert(hitos).values({
    tenantId, expedienteId, licitacionId, tipo, nombre,
    descripcion: `Hito ${MARK}`, fechaProgramada: when, estado, cumplido: estado === "COMPLETADO",
    fechaRealizada: estado === "COMPLETADO" ? when : null,
  });
}

async function presentOffer(licitacionId: number, proveedorId: number, monto: string, plazo: number) {
  const existing = await db.query.participaciones.findFirst({
    where: and(eq(participaciones.tenantId, tenantId), eq(participaciones.licitacionId, licitacionId), eq(participaciones.proveedorId, proveedorId)),
  });
  if (existing) return existing.id;
  const recibidoAt = new Date();
  const partId = insertId(await db.insert(participaciones).values({
    tenantId, licitacionId, proveedorId,
    montoOferta: ENVELOPE_PLACEHOLDER_MONTO, monedaOferta: "MXN", plazoEjecucion: plazo,
    estadoEvaluacion: "PENDIENTE", recibidoAt,
  }));
  const propId = insertId(await db.insert(proposiciones).values({
    tenantId, licitacionId, proveedorId, participacionId: partId, recibidoAt,
    estado: "SELLADA", montoOferta: ENVELOPE_PLACEHOLDER_MONTO, sealedAt: recibidoAt,
    manifestHash: createHash("sha256").update(`manifest:${licitacionId}:${proveedorId}:${monto}`).digest("hex"),
    sealHash: createHash("sha256").update(`seal:${licitacionId}:${proveedorId}:${monto}`).digest("hex"),
  }));
  const sobre = await db.query.sobresEconomicos.findFirst({
    where: and(eq(sobresEconomicos.tenantId, tenantId), eq(sobresEconomicos.participacionId, partId)),
  });
  if (!sobre) {
    await insertSobreEconomico(db, { tenantId, licitacionId, participacionId: partId, proposicionId: propId, monto });
  }
  return partId;
}

async function ensureLicitacion(input: {
  codigo: string; titulo: string; objeto: string; tipoLicitacion: any; tipoContratacion: any;
  estado: any; etapa: any; monto: string; policy: any; modalidadMeta?: Record<string, unknown> | null;
  pub: number; cierre: number; apertura: number;
}) {
  let lic = await db.query.licitaciones.findFirst({ where: and(eq(licitaciones.tenantId, tenantId), eq(licitaciones.codigo, input.codigo)) });
  const fechaPublicacion = dateOnly(daysFromNow(input.pub));
  const fechaCierre = dateOnly(daysFromNow(input.cierre));
  const fechaApertura = dateOnly(daysFromNow(input.apertura));
  if (!lic) {
    const id = insertId(await db.insert(licitaciones).values({
      tenantId, codigo: input.codigo, titulo: input.titulo, objeto: input.objeto,
      descripcionDetallada: `${input.objeto}\n\n[arranque operativo / QA — ${MARK}]`,
      estado: input.estado, etapa: input.etapa, entidadId, categoriaId, convocanteId: adminId,
      tipoLicitacion: input.tipoLicitacion, tipoContratacion: input.tipoContratacion,
      montoPresupuestado: input.monto, moneda: "MXN",
      fechaPublicacion: fechaPublicacion as any, fechaCierre: fechaCierre as any, fechaApertura: fechaApertura as any,
      criterioEvaluacion: "MEJOR_RELACION_CALIDAD_PRECIO",
      ponderacionTecnica: "40.00", ponderacionEconomica: "60.00", modoEvaluacion: "HIBRIDA",
      policyId: input.policy.id, policyVersionId: input.policy.id,
      modalidadMeta: input.modalidadMeta ?? null,
    } as any));
    lic = await db.query.licitaciones.findFirst({ where: eq(licitaciones.id, id) });
  } else {
    await db.update(licitaciones).set({
      estado: input.estado, etapa: input.etapa, policyId: input.policy.id, policyVersionId: input.policy.id,
      modalidadMeta: input.modalidadMeta ?? null, fechaPublicacion: fechaPublicacion as any, fechaCierre: fechaCierre as any, fechaApertura: fechaApertura as any, deletedAt: null,
    }).where(eq(licitaciones.id, lic.id));
    lic = await db.query.licitaciones.findFirst({ where: eq(licitaciones.id, lic.id) });
  }
  const licitacionId = lic!.id;
  let exp = await db.query.expedientes.findFirst({ where: and(eq(expedientes.tenantId, tenantId), eq(expedientes.licitacionId, licitacionId)) });
  if (!exp) {
    const eid = insertId(await db.insert(expedientes).values({
      tenantId, licitacionId, folio: `EXP-${input.codigo}`, marcoJuridico: "LAASSP",
      estado: "INTEGRACION", version: 1, eventSequence: 0,
    }));
    exp = await db.query.expedientes.findFirst({ where: eq(expedientes.id, eid) });
  }
  await freezePolicy(licitacionId, input.tipoLicitacion, input.tipoContratacion, input.policy);
  await ensureAsignacion(licitacionId, "creador");
  return { lic: lic!, exp: exp! };
}

const polLp = await loadPolicy("LICITACION_PUBLICA");
const polIt3 = await loadPolicy("INVITACION_TRES");
const polAd = await loadPolicy("ADJUDICACION_DIRECTA");
const polDc = await loadPolicy("DIALOGO_COMPETITIVO");

const lp = await ensureLicitacion({
  codigo: `${MARK}-LP-2026-001`,
  titulo: "Adquisición de equipo de cómputo y periféricos para oficinas estatales",
  objeto: "Suministro de equipos de cómputo de escritorio, portátiles y periféricos conforme a especificaciones técnicas del pliego, con garantía y soporte en territorio nacional.",
  tipoLicitacion: "LICITACION_PUBLICA", tipoContratacion: "BIENES",
  estado: "PUBLICADA", etapa: "PRESENTACION", monto: "12500000.00", policy: polLp,
  pub: -10, cierre: 15, apertura: 16,
});
await ensureCalendario(lp.lic.id, [
  { acto: "JUNTA_ACLARACIONES", start: daysFromNow(-5), end: daysFromNow(-3) },
  { acto: "RECEPCION", start: daysFromNow(-2), end: daysFromNow(15) },
  { acto: "APERTURA", start: daysFromNow(16), end: daysFromNow(16) },
  { acto: "EVALUACION", start: daysFromNow(17), end: daysFromNow(25) },
  { acto: "DICTAMEN", start: daysFromNow(26), end: daysFromNow(28) },
  { acto: "FALLO", start: daysFromNow(29), end: daysFromNow(30) },
]);
await ensureHito(lp.exp.id, lp.lic.id, "PUBLICACION", "Publicación de convocatoria", daysFromNow(-10), "COMPLETADO");
await ensureHito(lp.exp.id, lp.lic.id, "JUNTA_ACLARACIONES", "Junta de aclaraciones", daysFromNow(-4), "COMPLETADO");
await ensureHito(lp.exp.id, lp.lic.id, "APERTURA_SOBRES", "Apertura de proposiciones", daysFromNow(16), "PENDIENTE");
await presentOffer(lp.lic.id, proveedorIds[0], "11850000.00", 60);
await presentOffer(lp.lic.id, proveedorIds[1], "12120000.00", 45);
await presentOffer(lp.lic.id, proveedorIds[2], "11680000.00", 55);

const it3 = await ensureLicitacion({
  codigo: `${MARK}-IT3-2026-002`,
  titulo: "Servicio de mantenimiento preventivo y correctivo de flotilla vehicular",
  objeto: "Contratación de servicios de mantenimiento vehicular para la flotilla institucional, incluyendo refacciones originales o equivalentes certificados.",
  tipoLicitacion: "INVITACION_TRES", tipoContratacion: "SERVICIO",
  estado: "PUBLICADA", etapa: "JUNTA_ACLARACIONES", monto: "3200000.00", policy: polIt3,
  pub: -3, cierre: 20, apertura: 21,
});
await ensureCalendario(it3.lic.id, [
  { acto: "RECEPCION", start: daysFromNow(-1), end: daysFromNow(20) },
  { acto: "APERTURA", start: daysFromNow(21), end: daysFromNow(21) },
  { acto: "EVALUACION", start: daysFromNow(22), end: daysFromNow(28) },
  { acto: "DICTAMEN", start: daysFromNow(29), end: daysFromNow(30) },
  { acto: "FALLO", start: daysFromNow(31), end: daysFromNow(32) },
]);
await ensureHito(it3.exp.id, it3.lic.id, "PUBLICACION", "Publicación de invitación", daysFromNow(-3), "COMPLETADO");
await ensureHito(it3.exp.id, it3.lic.id, "JUNTA_ACLARACIONES", "Periodo de aclaraciones", daysFromNow(5), "EN_PROGRESO");
{
  const junta = await db.query.aclaracionesJuntas.findFirst({
    where: and(eq(aclaracionesJuntas.tenantId, tenantId), eq(aclaracionesJuntas.licitacionId, it3.lic.id)),
  });
  if (!junta) {
    await db.insert(aclaracionesJuntas).values({
      tenantId, expedienteId: it3.exp.id, licitacionId: it3.lic.id,
      nombre: "Junta de aclaraciones — mantenimiento vehicular",
      modalidad: "VIRTUAL", fechaProgramada: daysFromNow(5), fechaLimitePreguntas: daysFromNow(3),
      estado: "ABIERTA", lugarOEnlace: "https://meet.gob.mx/ops-it3-aclaraciones", creadaPor: adminId,
    });
  }
}

const ad = await ensureLicitacion({
  codigo: `${MARK}-AD-2026-003`,
  titulo: "Adquisición urgente de licencias de software de seguridad perimetral",
  objeto: "Adjudicación directa de licencias y soporte anual de plataforma de seguridad perimetral, con fundamento en supuesto de excepción aplicable.",
  tipoLicitacion: "ADJUDICACION_DIRECTA", tipoContratacion: "BIENES",
  estado: "EN_EVALUACION", etapa: "EVALUACION", monto: "980000.00", policy: polAd,
  modalidadMeta: { fundamentoExcepcion: "Art. 41 fracc. I LAASSP (seed operativo)", omitirAperturaPublica: true },
  pub: -2, cierre: 5, apertura: 5,
});
await ensureCalendario(ad.lic.id, [
  { acto: "EVALUACION", start: daysFromNow(-1), end: daysFromNow(4) },
  { acto: "DICTAMEN", start: daysFromNow(5), end: daysFromNow(6) },
  { acto: "FALLO", start: daysFromNow(7), end: daysFromNow(8) },
]);
await ensureHito(ad.exp.id, ad.lic.id, "EVALUACION_TECNICA", "Evaluación de propuesta única", daysFromNow(2), "EN_PROGRESO");
await presentOffer(ad.lic.id, proveedorIds[0], "965000.00", 30);

const dc = await ensureLicitacion({
  codigo: `${MARK}-DC-2026-004`,
  titulo: "Diálogo competitivo para plataforma de gestión documental institucional",
  objeto: "Desarrollo e implantación de plataforma de expediente electrónico y gestión documental, mediante diálogo competitivo con operadores calificados.",
  tipoLicitacion: "DIALOGO_COMPETITIVO", tipoContratacion: "SERVICIO",
  estado: "PUBLICADA", etapa: "CONVOCATORIA", monto: "45000000.00", policy: polDc,
  modalidadMeta: {
    autorizacionComiteRef: "COMITE-ADQ-2026-0142",
    autorizadoPorHacienda: true,
    oficioHaciendaRef: "SHCP/UPCP/2026/0881",
  },
  pub: -1, cierre: 40, apertura: 41,
});
await ensureCalendario(dc.lic.id, [
  { acto: "RECEPCION", start: daysFromNow(0), end: daysFromNow(40) },
  { acto: "EVALUACION", start: daysFromNow(41), end: daysFromNow(55) },
  { acto: "DICTAMEN", start: daysFromNow(56), end: daysFromNow(60) },
  { acto: "FALLO", start: daysFromNow(61), end: daysFromNow(65) },
]);
{
  const ronda = await db.query.dialogoRondas.findFirst({
    where: and(eq(dialogoRondas.tenantId, tenantId), eq(dialogoRondas.licitacionId, dc.lic.id), eq(dialogoRondas.ronda, 1)),
  });
  if (!ronda) {
    await db.insert(dialogoRondas).values({
      tenantId, licitacionId: dc.lic.id, expedienteId: dc.exp.id, ronda: 1,
      tema: "Arquitectura de expediente electrónico y modelo de interoperabilidad",
      participantes: proveedorIds.slice(0, 3),
      notas: "Ronda inicial de diálogo (seed operativo).",
      estado: "ABIERTA", createdBy: adminId,
      motivoApertura: "Apertura conforme a autorización de Comité COMITE-ADQ-2026-0142.",
    });
  }
}

let prog = await db.query.programasAnuales.findFirst({
  where: and(eq(programasAnuales.tenantId, tenantId), eq(programasAnuales.entidadId, entidadId), eq(programasAnuales.anio, 2026), eq(programasAnuales.nombre, `${MARK} Programa anual de adquisiciones 2026`)),
});
if (!prog) {
  await db.insert(programasAnuales).values({
    tenantId, entidadId, anio: 2026, nombre: `${MARK} Programa anual de adquisiciones 2026`, estado: "VIGENTE",
  });
}

let nec = await db.query.necesidades.findFirst({
  where: and(eq(necesidades.tenantId, tenantId), eq(necesidades.folio, `${MARK}-NEC-2026-01`)),
});
if (!nec) {
  const nid = insertId(await db.insert(necesidades).values({
    tenantId, entidadId, folio: `${MARK}-NEC-2026-01`,
    titulo: "Renovación de parque de cómputo institucional",
    descripcion: "Sustitución de equipos obsoletos en áreas centrales y foráneas.",
    justificacion: "Fin de soporte de hardware y riesgo operativo en continuidad de servicios.",
    estado: "APROBADA", montoEstimado: "12500000.00", tipoContratacion: "BIENES",
    creadaPor: adminId, aprobadaPor: adminId, aprobadaAt: new Date(),
  }));
  nec = await db.query.necesidades.findFirst({ where: eq(necesidades.id, nid) });
}

const inv = await db.query.investigacionesMercado.findFirst({
  where: and(eq(investigacionesMercado.tenantId, tenantId), eq(investigacionesMercado.folio, `${MARK}-IM-2026-01`)),
});
if (!inv) {
  await db.insert(investigacionesMercado).values({
    tenantId, necesidadId: nec!.id, licitacionId: lp.lic.id, folio: `${MARK}-IM-2026-01`,
    objeto: "Sondeo de precios de equipo de cómputo corporativo (seed operativo).",
    estado: "CONCLUIDA",
    resultado: "Se identificaron al menos tres proveedores con capacidad de suministro nacional.",
    conclusion: "Procedente licitación pública con presupuesto referencial de $12.5 MDP.",
    precioReferencia: "12200000.00", creadaPor: adminId, concluidaAt: new Date(),
  });
}

await db.execute(sql`
  INSERT IGNORE INTO alertas_seguridad
    (tenant_id, codigo, tipo, severidad, score, regla, evidencia, licitacion_id, proveedor_id, descripcion, estado, detectada_automaticamente)
  VALUES
    (${tenantId}, ${MARK + "-ALT-001"}, 'ANOMALIA_PRECIO', 'ALTA', 72.50, 'desviacion_precio_referencia',
     ${JSON.stringify({ ref: "12200000", observados: ["11850000", "11680000", "12120000"], nota: "seed operativo" })},
     ${lp.lic.id}, ${proveedorIds[2]},
     'Desviación de precios respecto a la investigación de mercado en la LP de equipo de cómputo.',
     'NUEVA', 1)
`);
const lics = await db.query.licitaciones.findMany({ where: and(eq(licitaciones.tenantId, tenantId), like(licitaciones.codigo, `${MARK}-%`)) });
const provs = await db.query.proveedores.findMany({ where: and(eq(proveedores.tenantId, tenantId), eq(proveedores.estadoVerificacion, "VERIFICADO")) });
console.log(`Seed operativo listo: licitaciones OPS=${lics.length}, proveedores verificados=${provs.length}`);
console.log("Etiqueta: datos de arranque operativo / QA (no es demostración de producto).");
process.exit(0);

