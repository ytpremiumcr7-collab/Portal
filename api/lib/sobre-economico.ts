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
    /** When true: plaintext monto without envelope — block convocante reads until migrated. */
    legacyPlaintext?: boolean;
  },
): T {
  const owner =
    opts.role === "proveedor" &&
    opts.viewerProveedorId != null &&
    opts.itemProveedorId != null &&
    Number(opts.viewerProveedorId) === Number(opts.itemProveedorId);

  // Legacy plaintext: never expose to convocante/admin until migrated into sobres.
  if (opts.legacyPlaintext && !owner) {
    const clone: Record<string, unknown> = { ...item };
    if ("montoOferta" in clone) clone.montoOferta = null;
    if ("puntajeEconomico" in clone) clone.puntajeEconomico = null;
    if ("montoAdjudicadoFinal" in clone) clone.montoAdjudicadoFinal = null;
    clone.legacyPlaintext = true;
    clone.sobreEconomicoSellado = false;
    return clone as T;
  }

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
  legacyPlaintext?: boolean;
}): boolean {
  if (input.legacyPlaintext && !(input.isOwner && input.role === "proveedor")) return false;
  if (input.isOwner && input.role === "proveedor") return true;
  return isSobreEconomicoRevelado(input.aperturaEstado);
}

/** True when monto looks like real plaintext (not envelope placeholder). */
export function isRealMontoOferta(monto: unknown): boolean {
  if (monto == null) return false;
  const s = String(monto);
  if (s === ENVELOPE_PLACEHOLDER_MONTO) return false;
  const n = Number(s);
  return Number.isFinite(n) && n > 0;
}

/** Pure: legacy plaintext = real monto and no sobre in SELLADO/REVELADO (or PENDIENTE if ever added). */
export function isLegacyPlaintextCandidate(input: {
  montoOferta: unknown;
  hasSobreEconomico: boolean;
}): boolean {
  return isRealMontoOferta(input.montoOferta) && !input.hasSobreEconomico;
}

export function hasEnvelopeKeyConfigured(): boolean {
  return !!process.env.ARES_ENVELOPE_KEY?.trim();
}

/** Persist sealed envelope row (call inside participación create TX). */
export async function insertSobreEconomico(
  tx: any,
  input: {
    tenantId: number;
    licitacionId: number;
    participacionId: number;
    proposicionId?: number | null;
    monto: string | number;
  },
): Promise<EnvelopeSeal> {
  const { currentEnvelopeKeyVersion } = await import("./envelope-crypto");
  const keyVersion = currentEnvelopeKeyVersion();
  const seal = sealMontoOferta(input.monto, {
    tenantId: input.tenantId,
    licitacionId: input.licitacionId,
    participacionId: input.participacionId,
    proposicionId: input.proposicionId ?? null,
    keyVersion,
  });
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

async function resolveAadForParticipacion(
  dbOrTx: any,
  tenantId: number,
  participacionId: number,
  sobre: { proposicionId: number | null; keyVersion: number },
): Promise<{ tenantId: number; licitacionId: number; participacionId: number; proposicionId: number | null; keyVersion: number }> {
  const part = await dbOrTx.query.participaciones.findFirst({
    where: and(eq(participaciones.id, participacionId), eq(participaciones.tenantId, tenantId)),
    columns: { licitacionId: true },
  });
  if (!part) throw new Error(`Participación ${participacionId} no encontrada para AAD`);
  return {
    tenantId,
    licitacionId: part.licitacionId,
    participacionId,
    proposicionId: sobre.proposicionId ?? null,
    keyVersion: sobre.keyVersion,
  };
}

/** Decrypt monto from sobre (server-side; never return ciphertext to client). AAD-bound. */
export async function decryptMontoParticipacion(
  dbOrTx: any,
  tenantId: number,
  participacionId: number,
): Promise<string | null> {
  const row = await loadSobreForParticipacion(dbOrTx, tenantId, participacionId);
  if (!row) return null;
  const aadCtx = await resolveAadForParticipacion(dbOrTx, tenantId, participacionId, row);
  return openMontoOferta({
    ciphertext: row.ciphertext,
    nonceIv: row.nonceIv,
    authTag: row.authTag,
    keyVersion: row.keyVersion,
    algorithm: row.algorithm,
  }, aadCtx);
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
            }, {
              tenantId: input.tenantId,
              licitacionId: input.licitacionId,
              participacionId: sobre.participacionId,
              proposicionId: sobre.proposicionId ?? null,
              keyVersion: sobre.keyVersion,
            });
    } else {
      monto = openMontoOferta({
        ciphertext: sobre.ciphertext,
        nonceIv: sobre.nonceIv,
        authTag: sobre.authTag,
        keyVersion: sobre.keyVersion,
        algorithm: sobre.algorithm,
      }, {
        tenantId: input.tenantId,
        licitacionId: input.licitacionId,
        participacionId: sobre.participacionId,
        proposicionId: sobre.proposicionId ?? null,
        keyVersion: sobre.keyVersion,
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


/**
 * Find participaciones with real montoOferta and no sobres_economicos row.
 * Prefer encrypt+placeholder when ARES_ENVELOPE_KEY is set.
 * If key missing: leave rows flagged as legacy_plaintext (caller must block convocante reads).
 */
export async function migrateLegacyPlaintextMontos(
  dbOrTx: any = getDb(),
  opts: { tenantId?: number; dryRun?: boolean } = {},
): Promise<{
  scanned: number;
  migrated: number;
  flaggedLegacy: number;
  keyPresent: boolean;
  idsMigrated: number[];
  idsFlagged: number[];
}> {
  const keyPresent = hasEnvelopeKeyConfigured();
  const conditions = [];
  if (opts.tenantId != null) conditions.push(eq(participaciones.tenantId, opts.tenantId));
  const parts = await dbOrTx.query.participaciones.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    columns: { id: true, tenantId: true, licitacionId: true, montoOferta: true },
  });
  let scanned = 0;
  let migrated = 0;
  let flaggedLegacy = 0;
  const idsMigrated: number[] = [];
  const idsFlagged: number[] = [];

  for (const part of parts) {
    if (!isRealMontoOferta(part.montoOferta)) continue;
    scanned += 1;
    const sobre = await loadSobreForParticipacion(dbOrTx, part.tenantId, part.id);
    if (sobre) continue; // already has SELLADO/REVELADO envelope
    if (!isLegacyPlaintextCandidate({ montoOferta: part.montoOferta, hasSobreEconomico: false })) continue;

    if (!keyPresent) {
      flaggedLegacy += 1;
      idsFlagged.push(part.id);
      continue;
    }
    if (opts.dryRun) {
      migrated += 1;
      idsMigrated.push(part.id);
      continue;
    }
    const monto = String(part.montoOferta);
    await insertSobreEconomico(dbOrTx, {
      tenantId: part.tenantId,
      licitacionId: part.licitacionId,
      participacionId: part.id,
      monto,
    });
    await dbOrTx
      .update(participaciones)
      .set({ montoOferta: ENVELOPE_PLACEHOLDER_MONTO } as any)
      .where(and(eq(participaciones.id, part.id), eq(participaciones.tenantId, part.tenantId)));
    await dbOrTx
      .update(proposiciones)
      .set({ montoOferta: ENVELOPE_PLACEHOLDER_MONTO } as any)
      .where(
        and(
          eq(proposiciones.tenantId, part.tenantId),
          eq(proposiciones.participacionId, part.id),
        ),
      );
    migrated += 1;
    idsMigrated.push(part.id);
  }

  return { scanned, migrated, flaggedLegacy, keyPresent, idsMigrated, idsFlagged };
}

export { ENVELOPE_PLACEHOLDER_MONTO };
