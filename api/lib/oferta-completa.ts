import { TRPCError } from "@trpc/server";

/** Document types that constitute a complete documental offer (default). */
export const OFERTA_DOC_TIPOS_DEFAULT = ["OFERTA_TECNICA", "OFERTA_ECONOMICA"] as const;

export type DocSnapshot = {
  tipo: string;
  proveedorId: number | null | undefined;
  estado: string;
  esVersionVigente: boolean | null | undefined;
};

/**
 * Pure: a participación (bare offer row) is documental-complete only when every
 * required tipo exists as APROBADO + vigente for that proveedor.
 * Bare participación alone is never enough.
 */
export function isOfertaDocumentalCompleta(
  proveedorId: number,
  docs: DocSnapshot[],
  requiredTipos: readonly string[] = OFERTA_DOC_TIPOS_DEFAULT,
): boolean {
  for (const tipo of requiredTipos) {
    const ok = docs.some(
      (d) =>
        Number(d.proveedorId) === Number(proveedorId) &&
        d.tipo === tipo &&
        d.estado === "APROBADO" &&
        d.esVersionVigente === true,
    );
    if (!ok) return false;
  }
  return true;
}

export function assertOfertasDocumentalesCompletas(
  offers: Array<{ id: number; proveedorId: number }>,
  docs: DocSnapshot[],
  requiredTipos: readonly string[] = OFERTA_DOC_TIPOS_DEFAULT,
) {
  const incomplete: number[] = [];
  for (const o of offers) {
    if (!isOfertaDocumentalCompleta(o.proveedorId, docs, requiredTipos)) {
      incomplete.push(o.id);
    }
  }
  if (incomplete.length) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `Oferta documental incompleta (se requiere ${requiredTipos.join(" + ")} APROBADO/vigente). ` +
        `Participaciones incompletas: ${incomplete.join(", ")}. La mera participación no constituye propuesta completa.`,
    });
  }
}
