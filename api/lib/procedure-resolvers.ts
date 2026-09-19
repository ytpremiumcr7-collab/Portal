import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../queries/connection";
import {
  aperturas,
  contratos,
  actosTerminacion,
  garantias,
  inconformidades,
  estimacionesPago,
  modificacionesContractuales,
  ejecucionesContractuales,
  entregables,
  finiquitos,
  dictamenes,
  fallos,
  actoAdjudicacion,
} from "@db/schema";

type IdInput = { id?: number; licitacionId?: number; contratoId?: number; dictamenId?: number };

export function licitacionIdFromInput(input: unknown): number {
  const i = input as IdInput;
  if (i?.licitacionId && Number(i.licitacionId) > 0) return Number(i.licitacionId);
  if (i?.id && Number(i.id) > 0) return Number(i.id);
  throw new TRPCError({ code: "BAD_REQUEST", message: "licitacionId requerido." });
}

export async function licitacionIdFromApertura(input: unknown, tenantId: number): Promise<number> {
  const id = Number((input as IdInput).id);
  const row = await getDb().query.aperturas.findFirst({
    where: and(eq(aperturas.id, id), eq(aperturas.tenantId, tenantId)),
    columns: { licitacionId: true },
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Apertura no encontrada." });
  return row.licitacionId;
}

export async function licitacionIdFromContrato(input: unknown, tenantId: number): Promise<number> {
  const i = input as IdInput;
  const contratoId = Number(i.contratoId ?? i.id);
  const row = await getDb().query.contratos.findFirst({
    where: and(eq(contratos.id, contratoId), eq(contratos.tenantId, tenantId)),
    columns: { licitacionId: true },
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
  return row.licitacionId;
}

export async function licitacionIdFromGarantia(input: unknown, tenantId: number): Promise<number> {
  const id = Number((input as IdInput).id);
  const g = await getDb().query.garantias.findFirst({
    where: and(eq(garantias.id, id), eq(garantias.tenantId, tenantId)),
    columns: { contratoId: true },
  });
  if (!g) throw new TRPCError({ code: "NOT_FOUND", message: "Garantía no encontrada." });
  return licitacionIdFromContrato({ id: g.contratoId }, tenantId);
}

export async function licitacionIdFromTerminacion(input: unknown, tenantId: number): Promise<number> {
  const id = Number((input as IdInput).id);
  const row = await getDb().query.actosTerminacion.findFirst({
    where: and(eq(actosTerminacion.id, id), eq(actosTerminacion.tenantId, tenantId)),
    columns: { licitacionId: true },
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Acto de terminación no encontrado." });
  return row.licitacionId;
}

export async function licitacionIdFromInconformidad(input: unknown, tenantId: number): Promise<number> {
  const id = Number((input as IdInput).id);
  const row = await getDb().query.inconformidades.findFirst({
    where: and(eq(inconformidades.id, id), eq(inconformidades.tenantId, tenantId)),
    columns: { licitacionId: true },
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Inconformidad no encontrada." });
  return row.licitacionId;
}

export async function licitacionIdFromEstimacion(input: unknown, tenantId: number): Promise<number> {
  const id = Number((input as IdInput).id);
  const est = await getDb().query.estimacionesPago.findFirst({
    where: and(eq(estimacionesPago.id, id), eq(estimacionesPago.tenantId, tenantId)),
    columns: { contratoId: true },
  });
  if (!est) throw new TRPCError({ code: "NOT_FOUND", message: "Estimación no encontrada." });
  return licitacionIdFromContrato({ id: est.contratoId }, tenantId);
}

export async function licitacionIdFromDictamen(input: unknown, tenantId: number): Promise<number> {
  const i = input as IdInput;
  const id = Number(i.dictamenId ?? i.id);
  const row = await getDb().query.dictamenes.findFirst({
    where: and(eq(dictamenes.id, id), eq(dictamenes.tenantId, tenantId)),
    columns: { licitacionId: true },
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Dictamen no encontrado." });
  return row.licitacionId;
}

export async function licitacionIdFromFallo(input: unknown, tenantId: number): Promise<number> {
  const id = Number((input as IdInput).id);
  const row = await getDb().query.fallos.findFirst({
    where: and(eq(fallos.id, id), eq(fallos.tenantId, tenantId)),
    columns: { licitacionId: true },
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Fallo no encontrado." });
  return row.licitacionId;
}

export async function licitacionIdFromActoAdjudicacion(input: unknown, tenantId: number): Promise<number> {
  const i = input as IdInput;
  if (i.licitacionId) return Number(i.licitacionId);
  const id = Number(i.id);
  const row = await getDb().query.actoAdjudicacion.findFirst({
    where: and(eq(actoAdjudicacion.id, id), eq(actoAdjudicacion.tenantId, tenantId)),
    columns: { licitacionId: true },
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Acto de adjudicación no encontrado." });
  return row.licitacionId;
}

export async function licitacionIdFromModificacion(input: unknown, tenantId: number): Promise<number> {
  const i = input as IdInput;
  if (i.contratoId) return licitacionIdFromContrato(i, tenantId);
  const id = Number(i.id);
  const row = await getDb().query.modificacionesContractuales.findFirst({
    where: and(eq(modificacionesContractuales.id, id), eq(modificacionesContractuales.tenantId, tenantId)),
    columns: { contratoId: true },
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Modificación no encontrada." });
  return licitacionIdFromContrato({ id: row.contratoId }, tenantId);
}

export async function licitacionIdFromEjecucion(input: unknown, tenantId: number): Promise<number> {
  const i = input as IdInput;
  if (i.contratoId) return licitacionIdFromContrato(i, tenantId);
  const id = Number(i.id);
  const row = await getDb().query.ejecucionesContractuales.findFirst({
    where: and(eq(ejecucionesContractuales.id, id), eq(ejecucionesContractuales.tenantId, tenantId)),
    columns: { contratoId: true },
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Ejecución no encontrada." });
  return licitacionIdFromContrato({ id: row.contratoId }, tenantId);
}

export async function licitacionIdFromEntregable(input: unknown, tenantId: number): Promise<number> {
  const id = Number((input as IdInput).id);
  const row = await getDb().query.entregables.findFirst({
    where: and(eq(entregables.id, id), eq(entregables.tenantId, tenantId)),
    columns: { contratoId: true },
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Entregable no encontrado." });
  return licitacionIdFromContrato({ id: row.contratoId }, tenantId);
}

export async function licitacionIdFromFiniquito(input: unknown, tenantId: number): Promise<number> {
  const i = input as IdInput;
  if (i.contratoId) return licitacionIdFromContrato(i, tenantId);
  const id = Number(i.id);
  const row = await getDb().query.finiquitos.findFirst({
    where: and(eq(finiquitos.id, id), eq(finiquitos.tenantId, tenantId)),
    columns: { contratoId: true },
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Finiquito no encontrado." });
  return licitacionIdFromContrato({ id: row.contratoId }, tenantId);
}
