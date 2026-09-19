import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { aperturas } from "@db/schema";

/** Apertura states that reveal sealed economic envelopes. */
export const APERTURA_REVELA_SOBRE = new Set([
  "ABIERTA",
  "REGISTRADA",
  "ACTA_EMITIDA",
  "PUBLICADA",
]);

export function isSobreEconomicoRevelado(aperturaEstado: string | null | undefined): boolean {
  return !!aperturaEstado && APERTURA_REVELA_SOBRE.has(aperturaEstado);
}

export async function loadAperturaEstado(tenantId: number, licitacionId: number): Promise<string | null> {
  const row = await getDb().query.aperturas.findFirst({
    where: and(eq(aperturas.tenantId, tenantId), eq(aperturas.licitacionId, licitacionId)),
    columns: { estado: true },
  });
  return row?.estado ?? null;
}

/**
 * Redact montoOferta (and related economic fields) for unauthorized readers
 * before apertura ABIERTA/PUBLICADA (and later revelatory states).
 * Owner proveedor may always see their own sealed amount.
 */
export function redactParticipacionEconomica<T extends Record<string, unknown>>(
  item: T,
  opts: {
    role: string;
    viewerProveedorId?: number | null;
    itemProveedorId?: number | null;
    aperturaEstado: string | null | undefined;
  },
): T {
  const owner =
    opts.role === "proveedor" &&
    opts.viewerProveedorId != null &&
    opts.itemProveedorId != null &&
    Number(opts.viewerProveedorId) === Number(opts.itemProveedorId);
  if (owner || isSobreEconomicoRevelado(opts.aperturaEstado)) return item;

  const clone: Record<string, unknown> = { ...item };
  if ("montoOferta" in clone) clone.montoOferta = null;
  if ("puntajeEconomico" in clone) clone.puntajeEconomico = null;
  if ("montoAdjudicadoFinal" in clone) clone.montoAdjudicadoFinal = null;
  clone.sobreEconomicoSellado = true;
  return clone as T;
}

/** Pure predicate for tests. */
export function canViewMontoOferta(input: {
  role: string;
  isOwner: boolean;
  aperturaEstado: string | null | undefined;
}): boolean {
  if (input.isOwner && input.role === "proveedor") return true;
  return isSobreEconomicoRevelado(input.aperturaEstado);
}
