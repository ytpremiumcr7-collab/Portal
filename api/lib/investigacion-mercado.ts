import { and, desc, eq, inArray, sql } from "drizzle-orm";
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

/**
 * Evidencia de fuente: captura, oficio, tabulador, extracto CompraNet.
 * No se acredita con oferta, fallo, contrato ni garantía.
 */
export const TIPOS_SOPORTE_FUENTE = ["FUNDAMENTO_JURIDICO", "OTRO"] as const;

export const TIPOS_PROHIBIDOS_FUENTE = [
  "OFERTA_TECNICA",
  "OFERTA_ECONOMICA",
  "GARANTIA",
  "FALLO_ADJUDICACION",
  "CONTRATO",
  "FACTURA",
  "DICTAMEN",
  "ACTA_EVALUACION",
  "ACTA_APERTURA",
] as const;

/** Diálogo competitivo: la ley exceptúa IM previa. */
export function procedimientoExigeInvestigacionMercado(tipoLicitacion: string) {
  return tipoLicitacion !== "DIALOGO_COMPETITIVO";
}

export type FuenteDocumentoSnap = {
  esVersionVigente: boolean;
  estado: string;
  licitacionId?: number | null;
  tipo?: string | null;
} | null | undefined;

/** Pure predicate so unit tests can cover the gate without MariaDB. */
export function evaluateFuenteDocumento(doc: FuenteDocumentoSnap, licitacionId?: number | null): string | null {
  if (!doc) return "El documento de soporte de la fuente no existe en el tenant.";
  if (!doc.esVersionVigente) return "El documento de soporte debe ser la versión vigente del expediente.";
  if (doc.estado === "RECHAZADO" || doc.estado === "OBSOLETO") {
    return `El documento de soporte está ${doc.estado}; no acredita la fuente.`;
  }
  if (doc.tipo && (TIPOS_PROHIBIDOS_FUENTE as readonly string[]).includes(doc.tipo)) {
    return "Una oferta, garantía, fallo, dictamen o contrato no acredita una fuente de investigación de mercado.";
  }
  if (doc.tipo && !(TIPOS_SOPORTE_FUENTE as readonly string[]).includes(doc.tipo)) {
    return `El tipo documental ${doc.tipo} no acredita una fuente de mercado. Cargue el oficio, captura, tabulador o extracto como FUNDAMENTO_JURIDICO u OTRO en el expediente de la licitación.`;
  }
  if (licitacionId != null) {
    if (doc.licitacionId == null) {
      return "El documento de soporte debe estar vinculado a la licitación del estudio.";
    }
    if (Number(doc.licitacionId) !== Number(licitacionId)) {
      return "El documento de la fuente está vinculado a otra licitación.";
    }
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
    columns: { id: true, estado: true, codigo: true, titulo: true, tipoLicitacion: true },
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

export async function listFuentesConDocumento(tenantId: number, investigacionId: number) {
  const rows = await listFuentes(tenantId, investigacionId);
  const ids = rows.map((r) => r.documentoId).filter((id): id is number => id != null);
  if (!ids.length) return rows.map((r) => ({ ...r, documento: null as null }));
  const docs = await getDb().query.documentos.findMany({
    where: and(eq(documentos.tenantId, tenantId), inArray(documentos.id, ids)),
    columns: { id: true, tipo: true, nombreArchivo: true, estado: true, esVersionVigente: true, licitacionId: true },
  });
  const byId = new Map(docs.map((d) => [d.id, d]));
  return rows.map((r) => ({ ...r, documento: byId.get(r.documentoId) ?? null }));
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

/** Cerrar o concluir un estudio sin licitacionId deja publicar ciego: el gate busca por vínculo. */
export function assertEstudioListoParaCerrar(input: {
  licitacionId: number | null | undefined;
  fuentes: Array<{ tipo: string; documentoId: number | null }>;
}) {
  if (input.licitacionId == null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No se cierra ni concluye un estudio huérfano. Vincule la licitación: publicar busca un estudio CONCLUIDO con el mismo licitacionId.",
    });
  }
  assertEstudioPuedeCerrarse(input.fuentes);
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

export async function getEstudioPorLicitacion(tenantId: number, licitacionId: number) {
  const rows = await getDb().query.investigacionesMercado.findMany({
    where: and(eq(investigacionesMercado.tenantId, tenantId), eq(investigacionesMercado.licitacionId, licitacionId)),
    orderBy: [desc(investigacionesMercado.id)],
    limit: 1,
  });
  return rows[0] ?? null;
}

export async function estadoInvestigacionParaLicitacion(tenantId: number, licitacionId: number) {
  const lic = await assertLicitacionDelTenant(tenantId, licitacionId);
  const exige = procedimientoExigeInvestigacionMercado(lic.tipoLicitacion);
  const estudio = await getEstudioPorLicitacion(tenantId, licitacionId);
  const faltantes: string[] = [];
  if (!exige) {
    return {
      licitacionId,
      codigo: lic.codigo,
      tipoLicitacion: lic.tipoLicitacion,
      exigeInvestigacion: false,
      listoParaPublicarIm: true,
      estudio: estudio ?? null,
      faltantes: [] as string[],
      nota: "Diálogo competitivo: la ley exceptúa investigación de mercado previa.",
    };
  }
  if (!estudio) faltantes.push("No hay estudio vinculado a esta licitación.");
  else if (estudio.estado !== "CONCLUIDA") faltantes.push(`El estudio #${estudio.id} está ${estudio.estado}, no CONCLUIDA.`);
  return {
    licitacionId,
    codigo: lic.codigo,
    tipoLicitacion: lic.tipoLicitacion,
    exigeInvestigacion: true,
    listoParaPublicarIm: faltantes.length === 0,
    estudio: estudio ?? null,
    faltantes,
    nota: "Publicar exige estudio CONCLUIDO con este licitacionId. El estado en pantalla no basta.",
  };
}

export async function listDocumentosSoporte(tenantId: number, licitacionId: number) {
  return getDb().query.documentos.findMany({
    where: and(
      eq(documentos.tenantId, tenantId),
      eq(documentos.licitacionId, licitacionId),
      eq(documentos.esVersionVigente, true),
    ),
    columns: {
      id: true,
      tipo: true,
      nombreArchivo: true,
      estado: true,
      esVersionVigente: true,
      licitacionId: true,
    },
    orderBy: [desc(documentos.id)],
  });
}

export function documentoEsSoporteFuente(doc: { tipo: string; estado: string; esVersionVigente: boolean }) {
  return evaluateFuenteDocumento(doc, undefined) == null;
}

export async function countFuentesPorTipo(tenantId: number, investigacionId: number) {
  const rows = await listFuentes(tenantId, investigacionId);
  const byTipo: Record<string, number> = {};
  for (const r of rows) byTipo[r.tipo] = (byTipo[r.tipo] ?? 0) + 1;
  return { total: rows.length, tipos: Object.keys(byTipo).length, byTipo, rows };
}

void sql;
void inArray;
