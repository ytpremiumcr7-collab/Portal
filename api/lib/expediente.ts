import { and, asc, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../queries/connection";
import { expedienteEvents, expedienteRequirements, expedientes, documentos, licitaciones } from "@db/schema";
import { evidenceAnchors } from "@db/schema-institutional";
import type { TrpcContext } from "../context";
import {
  EVIDENCE_SCHEMA_V1,
  EVIDENCE_SCHEMA_V2,
  canonicalEventV1,
  canonicalEventV2,
  hashCanonical,
  schemaVersionOf,
} from "./evidence-canonical";
import { institutionalEnv } from "./institutional-env";

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

export async function appendExpedienteEvent(tx: any, ctx: TrpcContext, input: {
  expedienteId: number;
  tipo: string;
  estadoAnterior?: string | null;
  estadoNuevo?: string | null;
  motivo?: string | null;
  payload?: unknown;
  actorCapability?: string | null;
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
  const schemaVersion = institutionalEnv.evidenceSchemaVersion >= 2 ? EVIDENCE_SCHEMA_V2 : EVIDENCE_SCHEMA_V1;
  const v1 = {
    expedienteId: input.expedienteId, secuencia, tipo: input.tipo,
    estadoAnterior: input.estadoAnterior ?? null, estadoNuevo: input.estadoNuevo ?? null,
    actorUserId: ctx.user!.id, motivo: input.motivo ?? null, payload, timestamp, previousHash,
  };
  const eventHash = schemaVersion === EVIDENCE_SCHEMA_V2
    ? hashCanonical(canonicalEventV2({
      ...v1, schemaVersion: EVIDENCE_SCHEMA_V2, tenantId: ctx.user!.tenantId,
      actorCapability: input.actorCapability ?? null, requestId: ctx.requestId,
      sourceIp: ctx.ipAddress, verifiedClientIp: ctx.ipAddress,
    }))
    : hashCanonical(canonicalEventV1(v1));
  await tx.insert(expedienteEvents).values({
    tenantId: ctx.user!.tenantId, expedienteId: input.expedienteId, secuencia,
    tipo: input.tipo, estadoAnterior: input.estadoAnterior ?? null, estadoNuevo: input.estadoNuevo ?? null,
    actorUserId: ctx.user!.id, motivo: input.motivo ?? null,
    payload: payload == null ? null : JSON.stringify(payload),
    timestamp: new Date(timestamp), ipAddress: ctx.ipAddress, requestId: ctx.requestId,
    previousHash, eventHash,
  });
  await tx.execute(sql`UPDATE expediente_events SET schema_version = ${schemaVersion}, actor_capability = ${input.actorCapability ?? null}, verified_client_ip = ${ctx.ipAddress}, anchor_status = ${"PENDING_EXTERNAL"} WHERE tenant_id = ${ctx.user!.tenantId} AND expediente_id = ${input.expedienteId} AND secuencia = ${secuencia}`);
  await tx.insert(evidenceAnchors).values({
    tenantId: ctx.user!.tenantId, expedienteId: input.expedienteId, eventSequence: secuencia,
    eventHash, algorithm: "SHA256", status: "PENDING_EXTERNAL", tsaUrl: institutionalEnv.tsaUrl || null,
  });
  return { secuencia, eventHash, schemaVersion };
}

export async function verifyExpedienteEvidenceChain(tenantId: number, expedienteId: number) {
  const db = getDb();
  const events = await db.select().from(expedienteEvents).where(and(eq(expedienteEvents.tenantId, tenantId), eq(expedienteEvents.expedienteId, expedienteId))).orderBy(asc(expedienteEvents.secuencia));
  const extras = await db.execute(sql`SELECT secuencia, schema_version, actor_capability, verified_client_ip, request_id, ip_address FROM expediente_events WHERE tenant_id = ${tenantId} AND expediente_id = ${expedienteId} ORDER BY secuencia ASC`) as any;
  const extraRows: any[] = Array.isArray(extras) ? (Array.isArray(extras[0]) ? extras[0] : extras) : (extras?.rows ?? []);
  const extraBySeq = new Map<number, any>();
  for (const r of extraRows) extraBySeq.set(Number(r.secuencia ?? r.SECUENCIA), r);
  let previous: string | null = null;
  for (const event of events) {
    if (event.previousHash !== previous) return { valid: false, brokenAt: event.secuencia, reason: "previousHash" };
    let parsedPayload: unknown = null;
    try { parsedPayload = event.payload ? JSON.parse(event.payload) : null; } catch { return { valid: false, brokenAt: event.secuencia, reason: "payload" }; }
    const extra = extraBySeq.get(event.secuencia) ?? {};
    const version = schemaVersionOf({ schemaVersion: extra.schema_version ?? extra.schemaVersion ?? (event as any).schemaVersion });
    const v1 = {
      expedienteId: event.expedienteId, secuencia: event.secuencia, tipo: event.tipo,
      estadoAnterior: event.estadoAnterior, estadoNuevo: event.estadoNuevo, actorUserId: event.actorUserId,
      motivo: event.motivo, payload: parsedPayload, timestamp: event.timestamp.toISOString(), previousHash: event.previousHash,
    };
    const base = version === EVIDENCE_SCHEMA_V2
      ? canonicalEventV2({
        ...v1, schemaVersion: EVIDENCE_SCHEMA_V2, tenantId: event.tenantId,
        actorCapability: extra.actor_capability ?? extra.actorCapability ?? null,
        requestId: extra.request_id ?? extra.requestId ?? event.requestId ?? "",
        sourceIp: extra.ip_address ?? extra.ipAddress ?? event.ipAddress ?? null,
        verifiedClientIp: extra.verified_client_ip ?? extra.verifiedClientIp ?? event.ipAddress ?? null,
      })
      : canonicalEventV1(v1);
    if (hashCanonical(base) !== event.eventHash) return { valid: false, brokenAt: event.secuencia, reason: "eventHash", schemaVersion: version };
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
