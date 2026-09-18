import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../queries/connection";
import { expedienteEvents, expedienteRequirements, expedientes, documentos, hitos, licitaciones, users } from "@db/schema";
import type { TrpcContext } from "../context";

export const EXPEDIENTE_STATES = ["INTEGRACION", "REVISION_JURIDICA", "APROBADO", "OBSERVADO", "CERRADO", "ARCHIVADO"] as const;
export type ExpedienteState = typeof EXPEDIENTE_STATES[number];

const COMMON_REQUIREMENTS = [
  { codigo: "CONVOCATORIA", nombre: "Convocatoria o instrumento equivalente", tipoDocumento: "CONVOCATORIA" },
  { codigo: "FUNDAMENTO_JURIDICO", nombre: "Fundamento / dictamen jurídico de procedencia", tipoDocumento: "FUNDAMENTO_JURIDICO" },
  { codigo: "PLIEGO_TECNICO", nombre: "Documentación técnica / especificaciones", tipoDocumento: "PLIEGO_TECNICO" },
  { codigo: "PLIEGO_ADMINISTRATIVO", nombre: "Documentación administrativa", tipoDocumento: "PLIEGO_ADMINISTRATIVO" },
  { codigo: "JUNTA_ACLARACIONES", nombre: "Acta de junta de aclaraciones o constancia de no celebración", tipoDocumento: "JUNTA_ACLARACIONES" },
];

export function defaultRequirements(_marco: "LAASSP" | "LOPSRM") {
  // Fase 1: sólo requisitos de integración y revisión jurídica previos a publicación.
  // Acta de apertura, dictamen, fallo, contrato, etc. pertenecen a fases posteriores.
  return [...COMMON_REQUIREMENTS];
}

export async function findExpediente(tenantId: number, id: number) {
  const db = getDb();
  return db.query.expedientes.findFirst({
    where: and(eq(expedientes.id, id), eq(expedientes.tenantId, tenantId)),
    with: { licitacion: true, requirements: true, events: { orderBy: [asc(expedienteEvents.secuencia)] } },
  });
}

export async function findExpedienteByLicitacion(tenantId: number, licitacionId: number) {
  const db = getDb();
  return db.query.expedientes.findFirst({
    where: and(eq(expedientes.tenantId, tenantId), eq(expedientes.licitacionId, licitacionId)),
    with: { licitacion: true, requirements: { orderBy: [asc(expedienteRequirements.id)] }, events: { orderBy: [asc(expedienteEvents.secuencia)] } },
  });
}

export async function assertExpediente(tenantId: number, id: number) {
  const item = await findExpediente(tenantId, id);
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Expediente no encontrado en el tenant actual." });
  return item;
}

export async function createExpedienteForLicitacion(tx: any, ctx: TrpcContext, licitacion: typeof licitaciones.$inferInsert & { id: number }) {
  const marcoJuridico = licitacion.tipoContratacion === "OBRA" ? "LOPSRM" : "LAASSP";
  const folio = `EXP-${licitacion.codigo}`;
  const result = await tx.insert(expedientes).values({
    tenantId: ctx.user!.tenantId,
    licitacionId: licitacion.id,
    folio,
    marcoJuridico,
    estado: "INTEGRACION",
    version: 1,
  });
  const expedienteId = Number(result[0].insertId);
  await appendExpedienteEvent(tx, ctx, { expedienteId, tipo: "EXPEDIENTE_CREADO", estadoAnterior: null, estadoNuevo: "INTEGRACION", motivo: "Apertura del expediente electrónico", payload: { licitacionId: licitacion.id, folio } });
  for (const req of defaultRequirements(marcoJuridico)) {
    await tx.insert(expedienteRequirements).values({
      tenantId: ctx.user!.tenantId,
      expedienteId,
      codigo: req.codigo,
      nombre: req.nombre,
      tipoDocumento: req.tipoDocumento,
      requerido: true,
      estado: "PENDIENTE",
    });
  }
  return expedienteId;
}

function canonicalEvent(input: { expedienteId: number; secuencia: number; tipo: string; estadoAnterior: string | null; estadoNuevo: string | null; actorUserId: number; motivo: string | null; payload: unknown; timestamp: string; previousHash: string | null }) {
  return JSON.stringify(input);
}

export async function appendExpedienteEvent(tx: any, ctx: TrpcContext, input: {
  expedienteId: number;
  tipo: string;
  estadoAnterior?: string | null;
  estadoNuevo?: string | null;
  motivo?: string | null;
  payload?: unknown;
}) {
  await tx.update(expedientes).set({ eventSequence: sql`${expedientes.eventSequence} + 1` }).where(and(eq(expedientes.tenantId, ctx.user!.tenantId), eq(expedientes.id, input.expedienteId)));
  const sequenceRow = await tx.query.expedientes.findFirst({ where: and(eq(expedientes.tenantId, ctx.user!.tenantId), eq(expedientes.id, input.expedienteId)) });
  if (!sequenceRow) throw new TRPCError({ code: "NOT_FOUND", message: "Expediente no encontrado." });
  const secuencia = sequenceRow.eventSequence;
  const last = secuencia > 1 ? await tx.query.expedienteEvents.findFirst({
    where: and(eq(expedienteEvents.tenantId, ctx.user!.tenantId), eq(expedienteEvents.expedienteId, input.expedienteId)),
    orderBy: [desc(expedienteEvents.secuencia)],
  }) : null;
  const timestamp = new Date().toISOString();
  const previousHash = last?.eventHash ?? null;
  const payload = input.payload ?? null;
  const base = canonicalEvent({ expedienteId: input.expedienteId, secuencia, tipo: input.tipo, estadoAnterior: input.estadoAnterior ?? null, estadoNuevo: input.estadoNuevo ?? null, actorUserId: ctx.user!.id, motivo: input.motivo ?? null, payload, timestamp, previousHash });
  const eventHash = createHash("sha256").update(base).digest("hex");
  const meta = { ipAddress: ctx.ipAddress, requestId: ctx.requestId };
  await tx.insert(expedienteEvents).values({
    tenantId: ctx.user!.tenantId,
    expedienteId: input.expedienteId,
    secuencia,
    tipo: input.tipo,
    estadoAnterior: input.estadoAnterior ?? null,
    estadoNuevo: input.estadoNuevo ?? null,
    actorUserId: ctx.user!.id,
    motivo: input.motivo ?? null,
    payload: payload == null ? null : JSON.stringify(payload),
    timestamp: new Date(timestamp),
    ipAddress: meta.ipAddress,
    requestId: meta.requestId,
    previousHash,
    eventHash,
  });
  return { secuencia, eventHash };
}

export async function verifyExpedienteEvidenceChain(tenantId: number, expedienteId: number) {
  const db = getDb();
  const events = await db.select().from(expedienteEvents).where(and(eq(expedienteEvents.tenantId, tenantId), eq(expedienteEvents.expedienteId, expedienteId))).orderBy(asc(expedienteEvents.secuencia));
  let previous: string | null = null;
  for (const event of events) {
    if (event.previousHash !== previous) return { valid: false, brokenAt: event.secuencia };
    let parsedPayload: unknown = null;
    try { parsedPayload = event.payload ? JSON.parse(event.payload) : null; } catch { return { valid: false, brokenAt: event.secuencia }; }
    const base = canonicalEvent({ expedienteId: event.expedienteId, secuencia: event.secuencia, tipo: event.tipo, estadoAnterior: event.estadoAnterior, estadoNuevo: event.estadoNuevo, actorUserId: event.actorUserId, motivo: event.motivo, payload: parsedPayload, timestamp: event.timestamp.toISOString(), previousHash: event.previousHash });
    const expected = createHash("sha256").update(base).digest("hex");
    if (expected !== event.eventHash) return { valid: false, brokenAt: event.secuencia };
    previous = event.eventHash;
  }
  return { valid: true, brokenAt: null, events: events.length };
}

export async function refreshRequirementStatuses(tx: any, tenantId: number, expedienteId: number) {
  const requirements = await tx.query.expedienteRequirements.findMany({ where: and(eq(expedienteRequirements.tenantId, tenantId), eq(expedienteRequirements.expedienteId, expedienteId)) });
  for (const req of requirements) {
    const doc = await tx.query.documentos.findFirst({
      where: and(eq(documentos.tenantId, tenantId), eq(documentos.expedienteId, expedienteId), eq(documentos.tipo, req.tipoDocumento as any), eq(documentos.esVersionVigente, true), eq(documentos.estado, "APROBADO")),
      orderBy: [desc(documentos.version)],
    });
    const estado = doc ? "CUMPLIDO" : req.estado === "NO_APLICA" ? "NO_APLICA" : req.estado === "OBSERVADO" ? "OBSERVADO" : req.requerido ? "PENDIENTE" : "NO_APLICA";
    if (req.estado !== estado || (doc?.id ?? null) !== (req.documentoActualId ?? null)) {
      await tx.update(expedienteRequirements).set({ estado, documentoActualId: doc?.id ?? null, validadoAt: doc ? new Date() : null }).where(and(eq(expedienteRequirements.id, req.id), eq(expedienteRequirements.tenantId, tenantId)));
    }
  }
}

export async function assertExpedienteComplete(tenantId: number, expedienteId: number) {
  const db = getDb();
  await refreshRequirementStatuses(db, tenantId, expedienteId);
  const reqs = await db.query.expedienteRequirements.findMany({ where: and(eq(expedienteRequirements.tenantId, tenantId), eq(expedienteRequirements.expedienteId, expedienteId)) });
  const missing = reqs.filter((r) => r.requerido && r.estado !== "CUMPLIDO");
  if (missing.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Expediente incompleto. Faltan requisitos: ${missing.map((r) => r.codigo).join(", ")}.` });
  return reqs;
}
