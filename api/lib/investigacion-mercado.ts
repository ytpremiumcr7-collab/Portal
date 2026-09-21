import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../queries/connection";
import { documentos, investigacionesMercado, licitaciones } from "@db/schema";
import { fuentesMercado } from "@db/schema-institutional";

/** Fuentes del art. 47 RLAASSP / práctica LOPSRM. No son proposiciones. */
export const FUENTES_MERCADO = [
  "PLATAFORMA_HISTORICA",
  "CAMARA_ORGANISMO",
  "CONSULTA_WEB",
  "OFICIO",
  "SOLICITUD_INFORMATIVA",
  "TABULADOR_RAMO",
  "PRESUPUESTO_BASE",
] as const;
export type FuenteMercadoTipo = typeof FUENTES_MERCADO[number];

export const MODALIDADES_RECOMENDADAS = [
  "LICITACION_PUBLICA",
  "INVITACION_RESTRINGIDA",
  "INVITACION_TRES",
  "ADJUDICACION_DIRECTA",
  "DIALOGO_COMPETITIVO",
  "ACUERDO_MARCO_ASIGNACION",
] as const;

/** Diálogo competitivo: la ley exceptúa IM previa. */
export function procedimientoExigeInvestigacionMercado(tipoLicitacion: string) {
  return tipoLicitacion !== "DIALOGO_COMPETITIVO";
}

/** Pure predicate so unit tests can cover the gate without MariaDB. */
export function evaluateFuenteDocumento(
  doc: { esVersionVigente: boolean; estado: string; licitacionId?: number | null } | null | undefined,
  licitacionId?: number | null,
): string | null {
  if (!doc) return "El documento de soporte de la fuente no existe en el tenant.";
  if (!doc.esVersionVigente) return "El documento de soporte debe ser la versión vigente del expediente.";
  if (doc.estado === "RECHAZADO" || doc.estado === "OBSOLETO") {
    return `El documento de soporte está ${doc.estado}; no acredita la fuente.`;
  }
  if (licitacionId != null && doc.licitacionId != null && Number(doc.licitacionId) !== Number(licitacionId)) {
    return "El documento de la fuente está vinculado a otra licitación.";
  }
  return null;
}

export async function assertFuenteDocumento(input: {
  tenantId: number;
  documentoId: number;
  licitacionId?: number | null;
}) {
  const db = getDb();
  const doc = await db.query.documentos.findFirst({
    where: and(eq(documentos.id, input.documentoId), eq(documentos.tenantId, input.tenantId)),
  });
  const reason = evaluateFuenteDocumento(doc, input.licitacionId);
  if (reason) throw new TRPCError({ code: "PRECONDITION_FAILED", message: reason });
  return doc!;
}

export async function assertLicitacionDelTenant(tenantId: number, licitacionId: number) {
  const lic = await getDb().query.licitaciones.findFirst({
    where: and(eq(licitaciones.id, licitacionId), eq(licitaciones.tenantId, tenantId)),
    columns: { id: true, estado: true, codigo: true },
  });
  if (!lic || lic.estado === "ELIMINADA") {
    throw new TRPCError({ code: "NOT_FOUND", message: "La licitación no existe en el tenant." });
  }
  return lic;
}

export async function listFuentes(tenantId: number, investigacionId: number) {
  const db = getDb();
  return db.query.fuentesMercado.findMany({
    where: and(eq(fuentesMercado.tenantId, tenantId), eq(fuentesMercado.investigacionId, investigacionId)),
  });
}

export function assertEstudioPuedeCerrarse(fuentes: Array<{ tipo: string; documentoId: number | null }>) {
  if (fuentes.length < 2) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "La investigación de mercado exige al menos dos fuentes documentadas (art. 47 RLAASSP). Una cotización aislada no constituye el estudio.",
    });
  }
  const tipos = new Set(fuentes.map((f) => f.tipo));
  if (tipos.size < 2) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Las dos fuentes deben ser de tipo distinto (plataforma histórica, cámara, consulta web, oficio, solicitud informativa, tabulador o presupuesto base).",
    });
  }
  const sinExpediente = fuentes.filter((f) => !f.documentoId);
  if (sinExpediente.length) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Toda fuente requiere documento de soporte (captura, oficio, FO-CON-04, tabulador o extracto de plataforma) integrado al expediente.",
    });
  }
}

export async function assertInvestigacionConcluidaParaProcedimiento(input: {
  tenantId: number;
  licitacionId: number;
  tipoLicitacion: string;
}) {
  if (!procedimientoExigeInvestigacionMercado(input.tipoLicitacion)) return null;
  const db = getDb();
  const inv = await db.query.investigacionesMercado.findFirst({
    where: and(
      eq(investigacionesMercado.tenantId, input.tenantId),
      eq(investigacionesMercado.licitacionId, input.licitacionId),
      eq(investigacionesMercado.estado, "CONCLUIDA"),
    ),
  });
  if (!inv) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No puede publicarse el procedimiento sin investigación de mercado CONCLUIDA vinculada a esta licitación (acto de planeación previo; no es cotización ni proposición).",
    });
  }
  return inv;
}

export async function countFuentesPorTipo(tenantId: number, investigacionId: number) {
  const rows = await listFuentes(tenantId, investigacionId);
  const byTipo: Record<string, number> = {};
  for (const r of rows) byTipo[r.tipo] = (byTipo[r.tipo] ?? 0) + 1;
  return { total: rows.length, tipos: Object.keys(byTipo).length, byTipo, rows };
}

void sql;
