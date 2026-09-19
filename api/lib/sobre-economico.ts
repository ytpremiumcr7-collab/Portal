import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { aperturas, sobresEconomicos, participaciones, proposiciones } from "@db/schema";
import {
  ENVELOPE_PLACEHOLDER_MONTO,
  openMontoOferta,
  sealMontoOferta,
  type EnvelopeSeal,
} from "./envelope-crypto";

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
 * Owner proveedor may always see their own sealed amount (decrypt if still SELLADO).
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

/** Persist sealed envelope row (call inside participación create TX). */
export async function insertSobreEconomico(
  tx: any,
  input: {
    tenantId: number;
    participacionId: number;
    proposicionId?: number | null;
    monto: string | number;
  },
): Promise<EnvelopeSeal> {
  const seal = sealMontoOferta(input.monto);
  await tx.insert(sobresEconomicos).values({
    tenantId: input.tenantId,
    participacionId: input.participacionId,
    proposicionId: input.proposicionId ?? null,
    ciphertext: seal.ciphertext,
    nonceIv: seal.nonceIv,
    authTag: seal.authTag,
    keyVersion: seal.keyVersion,
    algorithm: seal.algorithm,
    estado: "SELLADO",
  } as any);
  return seal;
}

export async function loadSobreForParticipacion(
  dbOrTx: any,
  tenantId: number,
  participacionId: number,
) {
  return dbOrTx.query.sobresEconomicos.findFirst({
    where: and(
      eq(sobresEconomicos.tenantId, tenantId),
      eq(sobresEconomicos.participacionId, participacionId),
    ),
  });
}

/** Decrypt monto from sobre (server-side; never return ciphertext to client). */
export async function decryptMontoParticipacion(
  dbOrTx: any,
  tenantId: number,
  participacionId: number,
): Promise<string | null> {
  const row = await loadSobreForParticipacion(dbOrTx, tenantId, participacionId);
  if (!row) return null;
  return openMontoOferta({
    ciphertext: row.ciphertext,
    nonceIv: row.nonceIv,
    authTag: row.authTag,
    keyVersion: row.keyVersion,
    algorithm: row.algorithm,
  });
}

/**
 * Canonical reveal act: decrypt into participaciones/proposiciones montoOferta
 * and mark sobres REVELADO. Idempotent if already REVELADO.
 */
export async function revelarSobresEconomicos(
  tx: any,
  input: {
    tenantId: number;
    licitacionId: number;
    actorUserId: number;
    participacionIds?: number[];
  },
): Promise<{ revelados: number; montos: Map<number, string> }> {
  const conditions = [
    eq(participaciones.tenantId, input.tenantId),
    eq(participaciones.licitacionId, input.licitacionId),
  ];
  const offers = await tx.query.participaciones.findMany({
    where: and(...conditions),
    columns: { id: true },
  });
  const ids = (input.participacionIds ?? offers.map((o: { id: number }) => o.id)).map(Number);
  const montos = new Map<number, string>();
  let revelados = 0;
  if (!ids.length) return { revelados, montos };

  const sobres = await tx.query.sobresEconomicos.findMany({
    where: and(
      eq(sobresEconomicos.tenantId, input.tenantId),
      inArray(sobresEconomicos.participacionId, ids),
    ),
  });

  for (const sobre of sobres) {
    let monto: string;
    if (sobre.estado === "REVELADO") {
      const part = await tx.query.participaciones.findFirst({
        where: and(
          eq(participaciones.id, sobre.participacionId),
          eq(participaciones.tenantId, input.tenantId),
        ),
        columns: { montoOferta: true },
      });
      monto =
        part?.montoOferta && part.montoOferta !== ENVELOPE_PLACEHOLDER_MONTO
          ? String(part.montoOferta)
          : openMontoOferta({
              ciphertext: sobre.ciphertext,
              nonceIv: sobre.nonceIv,
              authTag: sobre.authTag,
              keyVersion: sobre.keyVersion,
              algorithm: sobre.algorithm,
            });
    } else {
      monto = openMontoOferta({
        ciphertext: sobre.ciphertext,
        nonceIv: sobre.nonceIv,
        authTag: sobre.authTag,
        keyVersion: sobre.keyVersion,
        algorithm: sobre.algorithm,
      });
      await tx
        .update(sobresEconomicos)
        .set({
          estado: "REVELADO",
          reveladoAt: new Date(),
          reveladoPor: input.actorUserId,
        } as any)
        .where(
          and(
            eq(sobresEconomicos.id, sobre.id),
            eq(sobresEconomicos.tenantId, input.tenantId),
            eq(sobresEconomicos.estado, "SELLADO"),
          ),
        );
      await tx
        .update(participaciones)
        .set({ montoOferta: monto } as any)
        .where(
          and(
            eq(participaciones.id, sobre.participacionId),
            eq(participaciones.tenantId, input.tenantId),
          ),
        );
      await tx
        .update(proposiciones)
        .set({ montoOferta: monto } as any)
        .where(
          and(
            eq(proposiciones.tenantId, input.tenantId),
            eq(proposiciones.participacionId, sobre.participacionId),
          ),
        );
      revelados += 1;
    }
    montos.set(sobre.participacionId, monto);
  }

  // Legacy rows without sobre: keep existing montoOferta as revealed
  for (const id of ids) {
    if (montos.has(id)) continue;
    const part = await tx.query.participaciones.findFirst({
      where: and(eq(participaciones.id, id), eq(participaciones.tenantId, input.tenantId)),
      columns: { montoOferta: true },
    });
    if (part?.montoOferta) montos.set(id, String(part.montoOferta));
  }

  return { revelados, montos };
}

/**
 * Hydrate owner monto from ciphertext when DB still holds placeholder.
 */
export async function hydrateOwnerMontoIfSealed<T extends Record<string, unknown>>(
  item: T,
  opts: { tenantId: number; isOwner: boolean; revelado: boolean },
): Promise<T> {
  if (!opts.isOwner || opts.revelado) return item;
  const monto = item.montoOferta;
  if (monto != null && String(monto) !== ENVELOPE_PLACEHOLDER_MONTO) return item;
  const partId = Number(item.id);
  if (!partId) return item;
  const decrypted = await decryptMontoParticipacion(getDb(), opts.tenantId, partId);
  if (!decrypted) return item;
  return { ...item, montoOferta: decrypted, sobreEconomicoSellado: true } as T;
}

export { ENVELOPE_PLACEHOLDER_MONTO };
