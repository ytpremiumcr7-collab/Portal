import { TRPCError } from "@trpc/server";
import { and, eq, asc, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { findExpedienteByLicitacion } from "./expediente";
import { licitaciones, licitacionSequences, documentos, hitos, participaciones, entidades, categorias, users } from "@db/schema";

export const MEXICO_STATES = [
  "Aguascalientes","Baja California","Baja California Sur","Campeche","Coahuila","Colima","Chiapas","Chihuahua","Ciudad de México","Durango","Guanajuato","Guerrero","Hidalgo","Jalisco","México","Michoacán","Morelos","Nayarit","Nuevo León","Oaxaca","Puebla","Querétaro","Quintana Roo","San Luis Potosí","Sinaloa","Sonora","Tabasco","Tamaulipas","Tlaxcala","Veracruz","Yucatán","Zacatecas",
] as const;

export const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3}$/i;

function toYmd(value?: string | Date | null): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function assertDateOrder(publicacion?: string | Date | null, cierre?: string | Date | null, apertura?: string | Date | null) {
  const pub = toYmd(publicacion); const cie = toYmd(cierre); const ape = toYmd(apertura);
  if (pub && cie && cie <= pub) throw new TRPCError({ code: "BAD_REQUEST", message: "La fecha de cierre debe ser estrictamente posterior a la fecha de publicación." });
  if (pub && ape && ape < pub) throw new TRPCError({ code: "BAD_REQUEST", message: "La fecha de apertura no puede ser anterior a la fecha de publicación." });
  if (cie && ape && ape > cie) throw new TRPCError({ code: "BAD_REQUEST", message: "La fecha de apertura no puede ser posterior a la fecha de cierre." });
}

export { toYmd };

export function validateWeights(tecnica: string | number, economica: string | number) {
  const t = Number(tecnica);
  const e = Number(economica);
  if (!Number.isFinite(t) || !Number.isFinite(e) || t < 0 || e < 0 || t > 100 || e > 100 || Math.round((t + e) * 100) / 100 !== 100) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Las ponderaciones técnica y económica deben estar entre 0 y 100 y sumar exactamente 100." });
  }
}

export function validateRubric(raw: string | null | undefined) {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "La rúbrica técnica debe ser JSON válido." }); }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "La rúbrica técnica debe contener al menos un criterio." });
  const weights = parsed.map((x: any) => Number(x?.peso));
  if (parsed.some((x: any) => typeof x?.codigo !== "string" || !x.codigo.trim() || !Number.isFinite(Number(x?.peso)) || Number(x.peso) < 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "Cada criterio técnico requiere código y peso válido." });
  const sum = weights.reduce((a, b) => a + b, 0);
  if (Math.round(sum * 100) / 100 !== 100) throw new TRPCError({ code: "BAD_REQUEST", message: "Los pesos de la rúbrica técnica deben sumar 100." });
  return parsed as Array<{ codigo: string; peso: number }>;
}

export async function nextLicitacionCode(tenantId: number, tx: any = getDb()) {
  const year = new Date().getFullYear();
  await tx.insert(licitacionSequences).values({ tenantId, anio: year, ultimoNumero: 0 }).onDuplicateKeyUpdate({ set: { ultimoNumero: sql`${licitacionSequences.ultimoNumero}` } });
  const row = await tx.select({ ultimoNumero: licitacionSequences.ultimoNumero }).from(licitacionSequences).where(and(eq(licitacionSequences.tenantId, tenantId), eq(licitacionSequences.anio, year))).for("update").limit(1);
  const next = Number(row[0]?.ultimoNumero ?? 0) + 1;
  await tx.update(licitacionSequences).set({ ultimoNumero: next }).where(and(eq(licitacionSequences.tenantId, tenantId), eq(licitacionSequences.anio, year)));
  return `ARES-MX-${year}-${String(next).padStart(6, "0")}`;
}

export async function assertLicitacionReadyForPublish(tenantId: number, id: number) {
  const db = getDb();
  const lic = await db.query.licitaciones.findFirst({ where: and(eq(licitaciones.id, id), eq(licitaciones.tenantId, tenantId)) });
  if (!lic) throw new TRPCError({ code: "NOT_FOUND", message: "Licitación no encontrada en el tenant actual." });
  if (lic.estado !== "BORRADOR") throw new TRPCError({ code: "CONFLICT", message: "Sólo una licitación en BORRADOR puede publicarse." });
  assertDateOrder(lic.fechaPublicacion, lic.fechaCierre, lic.fechaApertura);
  validateWeights(lic.ponderacionTecnica, lic.ponderacionEconomica);
  const rubric = validateRubric(lic.rubricaTecnica);
  if (lic.modoEvaluacion === "AUTOMATICA" && !rubric) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La evaluación automática requiere una rúbrica técnica válida." });
  if (!lic.fechaPublicacion || !lic.fechaCierre || !lic.fechaApertura) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La publicación requiere fecha de publicación, cierre y apertura definidas." });
  const [entidad, categoria, convocante] = await Promise.all([
    db.query.entidades.findFirst({ where: and(eq(entidades.id, lic.entidadId), eq(entidades.tenantId, tenantId), eq(entidades.activa, true), eq(entidades.verificada, true)) }),
    db.query.categorias.findFirst({ where: and(eq(categorias.id, lic.categoriaId), eq(categorias.tenantId, tenantId), eq(categorias.activa, true)) }),
    db.query.users.findFirst({ where: and(eq(users.id, lic.convocanteId), eq(users.tenantId, tenantId), inArray(users.role, ["admin", "licitante"] as const), eq(users.activo, true)) }),
  ]);
  if (!entidad) throw new TRPCError({ code: "BAD_REQUEST", message: "La entidad contratante debe existir, estar activa, verificada y pertenecer al tenant." });
  if (!categoria) throw new TRPCError({ code: "BAD_REQUEST", message: "La categoría no existe, está inactiva o no pertenece al tenant." });
  if (!convocante) throw new TRPCError({ code: "BAD_REQUEST", message: "El convocante debe ser un usuario activo con rol administrador o licitante del tenant." });
  const expediente = await findExpedienteByLicitacion(tenantId, id);
  if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La licitación debe tener expediente electrónico." });
  if (expediente.estado !== "APROBADO") throw new TRPCError({ code: "PRECONDITION_FAILED", message: `El expediente debe estar APROBADO por revisión jurídica antes de publicar. Estado actual: ${expediente.estado}.` });
  const docs = await db.query.documentos.findMany({ where: and(eq(documentos.tenantId, tenantId), eq(documentos.licitacionId, id), eq(documentos.estado, "APROBADO"), eq(documentos.esVersionVigente, true)) });
  const required = ["CONVOCATORIA", "PLIEGO_TECNICO", "PLIEGO_ADMINISTRATIVO"] as const;
  const present = new Set(docs.map(d => d.tipo));
  const missing = required.filter((x) => !present.has(x));
  if (missing.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Expediente incompleto. Faltan documentos aprobados: ${missing.join(", ")}.` });
  const clarification = await db.query.hitos.findFirst({ where: and(eq(hitos.tenantId, tenantId), eq(hitos.licitacionId, id), eq(hitos.tipo, "JUNTA_ACLARACIONES"), ne(hitos.estado, "CANCELADO")) });
  if (!clarification) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Debe existir un hito de Junta de Aclaraciones antes de publicar." });
  return lic;
}

export async function assertLicitacionExists(tenantId: number, id: number) {
  const db = getDb();
  const lic = await db.query.licitaciones.findFirst({ where: and(eq(licitaciones.id, id), eq(licitaciones.tenantId, tenantId)) });
  if (!lic) throw new TRPCError({ code: "NOT_FOUND", message: "Licitación no encontrada en el tenant actual." });
  return lic;
}

export async function calculateEconomicScores(tenantId: number, licitacionId: number) {
  const db = getDb();
  const offers = await db.select({ id: participaciones.id, montoOferta: participaciones.montoOferta }).from(participaciones).where(and(eq(participaciones.tenantId, tenantId), eq(participaciones.licitacionId, licitacionId), eq(participaciones.estadoEvaluacion, "ADMISIBLE"))).orderBy(asc(participaciones.montoOferta));
  if (!offers.length) return [] as Array<{ id: number; score: number }>;
  const min = Number(offers[0].montoOferta);
  return offers.map(o => ({ id: o.id, score: Math.max(0, Math.min(100, Number(((min / Number(o.montoOferta)) * 100).toFixed(2)))) }));
}
