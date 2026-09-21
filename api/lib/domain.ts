import { TRPCError } from "@trpc/server";
import { and, eq, asc, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { findExpedienteByLicitacion } from "./expediente";
import { assertInvestigacionConcluidaParaProcedimiento } from "./investigacion-mercado";
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
  return `PA-MX-${year}-${String(next).padStart(6, "0")}`;
}
