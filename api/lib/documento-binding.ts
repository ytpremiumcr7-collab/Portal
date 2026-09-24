import { TRPCError } from "@trpc/server";

export type DocBindingContext = {
  tenantId: number;
  expedienteId?: number | null;
  licitacionId?: number | null;
  lotId?: number | null;
  proveedorId?: number | null;
  expectedTipo: string;
};

/**
 * Verify document belongs to same tenant + same expediente/contrato/proveedor context
 * (not just tipo+APROBADO).
 */
export function assertDocumentoBoundToContext(
  doc: {
    tenantId: number;
    tipo: string;
    estado: string;
    esVersionVigente: boolean;
    expedienteId?: number | null;
    licitacionId?: number | null;
    lotId?: number | null;
    proveedorId?: number | null;
  } | null | undefined,
  ctx: DocBindingContext,
) {
  if (!doc) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Documento de evidencia no encontrado." });
  }
  if (Number(doc.tenantId) !== Number(ctx.tenantId)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El documento no pertenece al tenant." });
  }
  if (doc.tipo !== ctx.expectedTipo) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Se requiere documento tipo ${ctx.expectedTipo} APROBADO/vigente.`,
    });
  }
  if (doc.estado !== "APROBADO" || !doc.esVersionVigente) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Se requiere documento tipo ${ctx.expectedTipo} APROBADO/vigente.`,
    });
  }
  if (ctx.licitacionId != null && doc.licitacionId != null && Number(doc.licitacionId) !== Number(ctx.licitacionId)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "El documento no corresponde a la licitación del contexto.",
    });
  }
  if (ctx.expedienteId != null && doc.expedienteId != null && Number(doc.expedienteId) !== Number(ctx.expedienteId)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "El documento no corresponde al expediente del contexto.",
    });
  }
  if (ctx.lotId != null && Number(doc.lotId) !== Number(ctx.lotId)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "El documento no corresponde al lote adjudicado del contrato.",
    });
  }
  if (ctx.proveedorId != null && doc.proveedorId != null && Number(doc.proveedorId) !== Number(ctx.proveedorId)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "El documento no corresponde al proveedor del contexto.",
    });
  }
  // When document has no licitacion/expediente/proveedor set, still require tenant+tipo+APROBADO —
  // but if context expects licitacion and doc has null licitacionId, reject for safety.
  if (ctx.licitacionId != null && doc.licitacionId == null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "El documento debe estar vinculado a la licitación del contexto.",
    });
  }
}
