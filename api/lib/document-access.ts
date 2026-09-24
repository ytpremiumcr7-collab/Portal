import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../queries/connection";
import { aperturas, proposicionDocumentos, proposiciones } from "@db/schema";
import { supplierProviderIdsForUser } from "./supplier-authority";

/** Offer types sealed until apertura ABIERTA/PUBLICADA (and later revelatory states). */
export const OFFER_DOC_TIPOS = ["OFERTA_TECNICA", "OFERTA_ECONOMICA"] as const;

export type DocAccessUser = {
  id: number;
  tenantId: number;
  role: string;
};

export type DocAccessRow = {
  id: number;
  tenantId: number;
  tipo: string;
  esPublico: boolean;
  esVersionVigente: boolean;
  estado: string;
  licitacionId: number | null;
  proveedorId: number | null;
  proveedor?: unknown;
};

const POST_APERTURA = new Set(["ABIERTA", "REGISTRADA", "ACTA_EMITIDA", "PUBLICADA"]);

export async function loadAperturaEstadoForAccess(
  tenantId: number,
  licitacionId: number | null | undefined,
): Promise<string | null> {
  if (!licitacionId) return null;
  const row = await getDb().query.aperturas.findFirst({
    where: and(eq(aperturas.tenantId, tenantId), eq(aperturas.licitacionId, licitacionId)),
    columns: { estado: true },
  });
  return row?.estado ?? null;
}

export function isPostApertura(estado: string | null | undefined): boolean {
  return !!estado && POST_APERTURA.has(estado);
}

export function isOfferTipo(tipo: string): boolean {
  return (OFFER_DOC_TIPOS as readonly string[]).includes(tipo);
}

/**
 * Central document read authorization.
 * Pre-apertura: OFERTA_* and proposicion-bound docs → owning proveedor only (system seal paths bypass via opts).
 * Post-apertura: procedure-scoped readers (convocante/admin/evaluador/assigned) may read.
 * Public metadata is NOT enough here — anonymous public download uses assertPublicDocumentReadable.
 */
export async function authorizeDocumentRead(
  user: DocAccessUser,
  doc: DocAccessRow,
  opts?: { systemSeal?: boolean; aperturaEstado?: string | null; representedProviderIds?: readonly number[] },
): Promise<void> {
  if (opts?.systemSeal) return;

  if (doc.tenantId !== user.tenantId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Documento no encontrado." });
  }

  const representedProviderIds = user.role === "proveedor"
    ? (opts?.representedProviderIds ?? await supplierProviderIdsForUser(user.tenantId, user.id))
    : [];
  const isRepresentative =
    user.role === "proveedor" &&
    doc.proveedorId != null &&
    representedProviderIds.includes(Number(doc.proveedorId));

  // An active member of the represented supplier organization can read its own documents.
  if (isRepresentative) return;

  const aperturaEstado =
    opts?.aperturaEstado !== undefined
      ? opts.aperturaEstado
      : await loadAperturaEstadoForAccess(user.tenantId, doc.licitacionId);

  const boundToProposicion = await isProposicionBound(user.tenantId, doc.id);
  const sensitive = isOfferTipo(doc.tipo) || boundToProposicion;

  if (sensitive && !isPostApertura(aperturaEstado)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Documento de oferta no legible antes de la apertura (ABIERTA/PUBLICADA).",
    });
  }

  // Post-apertura or non-sensitive: convocante / admin / evaluador / licitante may read within tenant.
  if (["admin", "licitante", "evaluador", "convocante"].includes(user.role) || user.role === "admin") {
    return;
  }

  // Other proveedores cannot read peers' docs.
  if (user.role === "proveedor") {
    throw new TRPCError({ code: "FORBIDDEN", message: "No puede consultar este documento." });
  }

  // Fallback deny
  throw new TRPCError({ code: "FORBIDDEN", message: "Sin permiso de lectura documental." });
}

async function isProposicionBound(tenantId: number, documentoId: number): Promise<boolean> {
  const row = await getDb().query.proposicionDocumentos.findFirst({
    where: and(eq(proposicionDocumentos.tenantId, tenantId), eq(proposicionDocumentos.documentoId, documentoId)),
    columns: { id: true },
  });
  return !!row;
}

/**
 * Anonymous public download: esPublico + APROBADO + vigente + procedimiento publicable.
 */
export async function assertPublicDocumentReadable(doc: DocAccessRow & { licitacion?: { estado: string } | null }) {
  if (!doc.esPublico || !doc.esVersionVigente || doc.estado !== "APROBADO") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Documento no disponible públicamente." });
  }
  if (isOfferTipo(doc.tipo)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Las ofertas no son documentos públicos." });
  }
  const PUBLICABLE = new Set(["PUBLICADA", "EN_EVALUACION", "ADJUDICADA", "FINALIZADA", "DESIERTA", "CANCELADA"]);
  let estado = doc.licitacion?.estado;
  if (!estado && doc.licitacionId) {
    const { licitaciones } = await import("@db/schema");
    const lic = await getDb().query.licitaciones.findFirst({
      where: and(eq(licitaciones.id, doc.licitacionId), eq(licitaciones.tenantId, doc.tenantId)),
      columns: { estado: true },
    });
    estado = lic?.estado;
  }
  if (!estado || !PUBLICABLE.has(estado)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "El procedimiento no es publicable." });
  }
}

/** Filter a list of docs to those the user may read (drops unauthorized offers pre-apertura). */
export async function filterReadableDocuments<T extends DocAccessRow>(
  user: DocAccessUser,
  docs: T[],
): Promise<T[]> {
  const byLic = new Map<number, string | null>();
  const representedProviderIds = user.role === "proveedor"
    ? await supplierProviderIdsForUser(user.tenantId, user.id)
    : [];
  const out: T[] = [];
  for (const doc of docs) {
    try {
      let ap: string | null | undefined = undefined;
      if (doc.licitacionId) {
        if (!byLic.has(doc.licitacionId)) {
          byLic.set(doc.licitacionId, await loadAperturaEstadoForAccess(user.tenantId, doc.licitacionId));
        }
        ap = byLic.get(doc.licitacionId);
      }
      await authorizeDocumentRead(user, doc, { aperturaEstado: ap ?? null, representedProviderIds });
      out.push(doc);
    } catch {
      // omit
    }
  }
  return out;
}

export async function assertOfertaUploadAllowed(input: {
  tenantId: number;
  proveedorId: number;
  licitacionId: number | null | undefined;
  tipo: string;
}) {
  if (!isOfferTipo(input.tipo) && input.tipo !== "GARANTIA") return;
  if (!input.licitacionId) return;

  const ap = await loadAperturaEstadoForAccess(input.tenantId, input.licitacionId);
  if (ap && ap !== "RECEPCION_ABIERTA") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "La recepción está cerrada; no puede cargar/reemplazar ofertas.",
    });
  }

  const existing = await getDb().query.proposiciones.findFirst({
    where: and(
      eq(proposiciones.tenantId, input.tenantId),
      eq(proposiciones.licitacionId, input.licitacionId),
      eq(proposiciones.proveedorId, input.proveedorId),
    ),
    columns: { id: true },
  });
  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Ya existe proposición presentada; no puede cargar/reemplazar OFERTA_* para esta licitación.",
    });
  }
}
