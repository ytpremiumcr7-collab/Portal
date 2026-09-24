import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";

export type PropDocRol = "OFERTA_TECNICA" | "OFERTA_ECONOMICA" | "ANEXO" | "GARANTIA_SERIEDAD";

export type PropDocForManifest = {
  documentoId: number;
  rol: PropDocRol;
  sha256: string;
};

export type ConsorcioMiembroManifest = {
  proveedorId: number;
  rol: string;
  porcentajeParticipacion?: string | null;
};

export type ProposicionManifestInput = {
  proposicionId: number;
  participacionId: number;
  proveedorId: number;
  lotId: number;
  actorUserId: number;
  supplierMembershipId: number;
  actingAuthorityId: number;
  /** @deprecated Prefer ciphertextHash — seal must NOT require decrypt. */
  montoOferta?: string | number;
  /** SHA-256 of envelope ciphertext (or document+ciphertext binding). */
  ciphertextHash?: string | null;
  recibidoAt: string | Date;
  documentos: PropDocForManifest[];
  /** Frozen consorcio identity at present (required in hash when present). */
  consorcioId?: number | null;
  consorcioMiembros?: ConsorcioMiembroManifest[];
};

/**
 * Canonical per-participant proposición document set hash.
 * Seal uses document hashes + ciphertext hash — NEVER decrypted monto.
 */
export function buildProposicionManifest(input: ProposicionManifestInput): {
  payload: Record<string, unknown>;
  manifestHash: string;
} {
  const docs = [...input.documentos]
    .map((d) => ({ documentoId: d.documentoId, rol: d.rol, sha256: d.sha256 }))
    .sort((a, b) => a.documentoId - b.documentoId);
  const payload: Record<string, unknown> = {
    proposicionId: input.proposicionId,
    participacionId: input.participacionId,
    proveedorId: input.proveedorId,
    lotId: input.lotId,
    actorUserId: input.actorUserId,
    supplierMembershipId: input.supplierMembershipId,
    actingAuthorityId: input.actingAuthorityId,
    recibidoAt: new Date(input.recibidoAt).toISOString(),
    documentos: docs,
  };
  if (input.consorcioId != null) {
    const miembros = [...(input.consorcioMiembros ?? [])]
      .map((m) => ({
        proveedorId: m.proveedorId,
        rol: m.rol,
        porcentajeParticipacion: m.porcentajeParticipacion ?? null,
      }))
      .sort((a, b) => a.proveedorId - b.proveedorId);
    payload.consorcioId = input.consorcioId;
    payload.consorcioMiembros = miembros;
  }
  if (input.ciphertextHash) {
    payload.ciphertextHash = input.ciphertextHash;
  } else if (input.montoOferta != null) {
    // Legacy fallback only for tests without envelope — production paths must pass ciphertextHash.
    payload.montoOferta = Number(input.montoOferta).toFixed(2);
  }
  const manifestHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return { payload, manifestHash };
}

/** Pure: seal manifest does not need decrypted monto when ciphertextHash is present. */
export function sealManifestRequiresDecrypt(input: {
  ciphertextHash?: string | null;
  montoOferta?: string | number | null;
}): boolean {
  return !input.ciphertextHash;
}

/** Apertura seal must cover proposición manifests — not the full licitación document bag. */
export function buildAperturaSealFromProposicionManifests(
  manifests: Array<{ proposicionId: number; proveedorId: number; manifestHash: string }>,
): string {
  const sorted = [...manifests]
    .map((m) => ({
      proposicionId: m.proposicionId,
      proveedorId: m.proveedorId,
      manifestHash: m.manifestHash,
    }))
    .sort((a, b) => a.proposicionId - b.proposicionId);
  return createHash("sha256").update(JSON.stringify({ proposiciones: sorted })).digest("hex");
}

export function assertProposicionDocsCompletos(
  docs: readonly PropDocForManifest[],
  requisitos?: { garantiaSeriedad?: boolean; ofertaTecnica?: boolean; ofertaEconomica?: boolean },
) {
  const roles = new Set(docs.map((d) => d.rol));
  const needTech = requisitos?.ofertaTecnica !== false;
  const needEcon = requisitos?.ofertaEconomica !== false;
  if (needTech && !roles.has("OFERTA_TECNICA")) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "La proposición requiere OFERTA_TECNICA en el manifiesto sellado.",
    });
  }
  if (needEcon && !roles.has("OFERTA_ECONOMICA")) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "La proposición requiere OFERTA_ECONOMICA en el manifiesto sellado.",
    });
  }
  if (requisitos?.garantiaSeriedad && !roles.has("GARANTIA_SERIEDAD") && !docs.some((d) => d.rol === "ANEXO" && false)) {
    // Require explicit GARANTIA_SERIEDAD role or a doc mapped from tipo GARANTIA
    const hasGarantia = roles.has("GARANTIA_SERIEDAD");
    if (!hasGarantia) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "La política exige garantía de seriedad en la proposición sellada.",
      });
    }
  }
}

/** Completeness from sealed proposicion_documentos rows (downstream authority). */
export function assertProposicionSelladaCompleta(
  prop: { id: number; estado: string } | null | undefined,
  sealedDocs: readonly PropDocForManifest[],
  requisitos?: { garantiaSeriedad?: boolean; ofertaTecnica?: boolean; ofertaEconomica?: boolean },
) {
  if (!prop) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No existe proposición sellada; la bolsa viva de documentos no es autoridad.",
    });
  }
  if (!["SELLADA", "ADMISIBLE", "NO_ADMISIBLE", "DESECHADA", "GANADORA"].includes(prop.estado)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Proposición #${prop.id} no está sellada (estado=${prop.estado}).`,
    });
  }
  assertProposicionDocsCompletos(sealedDocs, requisitos);
}

/** Pending proposición estados that block dictamen/fallo progression. */
export const PROP_PENDING_ESTADOS = ["BORRADOR", "RECIBIDA"] as const;

export function assertProposicionesListasParaDictamen(
  props: readonly { id: number; estado: string }[],
) {
  const notReady = props.filter((p) => p.estado === "BORRADOR" || p.estado === "RECIBIDA");
  if (notReady.length) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Hay ${notReady.length} proposición(es) pendientes de sellado/evaluación.`,
    });
  }
}

export function mapDocTipoToRol(tipo: string): PropDocRol | null {
  if (tipo === "OFERTA_TECNICA") return "OFERTA_TECNICA";
  if (tipo === "OFERTA_ECONOMICA") return "OFERTA_ECONOMICA";
  if (tipo === "GARANTIA") return "GARANTIA_SERIEDAD";
  if (tipo === "ANEXO" || tipo.startsWith("ANEXO") || tipo === "OTRO") return "ANEXO";
  return null;
}

/** Sync proposición estado with participación evaluación outcome. */
export function mapEvalToProposicionEstado(
  estadoEvaluacion: string,
): "ADMISIBLE" | "NO_ADMISIBLE" | "DESECHADA" | "GANADORA" | null {
  if (estadoEvaluacion === "ADMISIBLE") return "ADMISIBLE";
  if (estadoEvaluacion === "NO_ADMISIBLE") return "NO_ADMISIBLE";
  if (estadoEvaluacion === "RECHAZADA" || estadoEvaluacion === "DESCARTADA") return "DESECHADA";
  if (estadoEvaluacion === "GANADORA") return "GANADORA";
  return null;
}
