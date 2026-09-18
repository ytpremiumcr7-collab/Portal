import { z } from "zod";
import { and, count, desc, eq, sql, or, isNull } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  licitaciones, fallos, contratos, documentos, proveedoresImpedidos, proveedores,
} from "@db/schema";
import { pageInput, pageResult } from "../lib/pagination";

/**
 * Public (unauthenticated) read surfaces — open-data style.
 * No admin/convocante auth required. Tenant scoped via optional tenantId or slug filter.
 */
export const consultaPublicaRouter = createRouter({
  procedimientos: publicQuery.input(z.object({
    tenantId: z.number().int().positive().optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(50).optional(),
  }).optional()).query(async ({ input }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize ?? 20);
    const conditions = [sql`${licitaciones.estado} IN ('PUBLICADA','EN_EVALUACION','ADJUDICADA','FINALIZADA')`];
    if (input?.tenantId) conditions.push(eq(licitaciones.tenantId, input.tenantId));
    const where = and(...conditions);
    const db = getDb();
    const [rows, totalRows] = await Promise.all([
      db.select({
        id: licitaciones.id, tenantId: licitaciones.tenantId, codigo: licitaciones.codigo,
        titulo: licitaciones.titulo, estado: licitaciones.estado, etapa: licitaciones.etapa,
        tipoLicitacion: licitaciones.tipoLicitacion, tipoContratacion: licitaciones.tipoContratacion,
        montoPresupuestado: licitaciones.montoPresupuestado, fechaPublicacion: licitaciones.fechaPublicacion,
        fechaCierre: licitaciones.fechaCierre,
      }).from(licitaciones).where(where).orderBy(desc(licitaciones.fechaPublicacion)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(licitaciones).where(where),
    ]);
    return pageResult(rows, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  adjudicaciones: publicQuery.input(z.object({
    tenantId: z.number().int().positive().optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(50).optional(),
  }).optional()).query(async ({ input }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize ?? 20);
    const conditions = [eq(fallos.estado, "PUBLICADO"), eq(fallos.sentido, "ADJUDICAR")];
    if (input?.tenantId) conditions.push(eq(fallos.tenantId, input.tenantId));
    const where = and(...conditions);
    const db = getDb();
    const [rows, totalRows] = await Promise.all([
      db.select({
        id: fallos.id, tenantId: fallos.tenantId, licitacionId: fallos.licitacionId,
        proveedorGanadorId: fallos.proveedorGanadorId, montoAdjudicado: fallos.montoAdjudicado,
        publicadoAt: fallos.publicadoAt,
      }).from(fallos).where(where).orderBy(desc(fallos.publicadoAt)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(fallos).where(where),
    ]);
    return pageResult(rows, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  contratos: publicQuery.input(z.object({
    tenantId: z.number().int().positive().optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(50).optional(),
  }).optional()).query(async ({ input }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize ?? 20);
    const conditions = [sql`${contratos.estado} IN ('FORMALIZADO','VIGENTE','TERMINADO')`];
    if (input?.tenantId) conditions.push(eq(contratos.tenantId, input.tenantId));
    const where = and(...conditions);
    const db = getDb();
    const [rows, totalRows] = await Promise.all([
      db.select({
        id: contratos.id, tenantId: contratos.tenantId, folio: contratos.folio,
        licitacionId: contratos.licitacionId, estado: contratos.estado,
        monto: contratos.monto, objeto: contratos.objeto, fechaFirma: contratos.fechaFirma,
      }).from(contratos).where(where).orderBy(desc(contratos.createdAt)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(contratos).where(where),
    ]);
    return pageResult(rows, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  sancionados: publicQuery.input(z.object({
    tenantId: z.number().int().positive().optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(50).optional(),
  }).optional()).query(async ({ input }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize ?? 20);
    const today = new Date().toISOString().slice(0, 10);
    // Match participación gate: activo + vigenciaDesde/Hasta window (not activo alone).
    const conditions = [
      eq(proveedoresImpedidos.activo, true),
      sql`${proveedoresImpedidos.vigenteDesde} <= ${today}`,
      or(isNull(proveedoresImpedidos.vigenteHasta), sql`${proveedoresImpedidos.vigenteHasta} >= ${today}`),
    ];
    if (input?.tenantId) conditions.push(eq(proveedoresImpedidos.tenantId, input.tenantId));
    const where = and(...conditions);
    const db = getDb();
    const [rows, totalRows] = await Promise.all([
      db.select({
        id: proveedoresImpedidos.id, tenantId: proveedoresImpedidos.tenantId,
        proveedorId: proveedoresImpedidos.proveedorId, sancionId: proveedoresImpedidos.sancionId,
        motivo: proveedoresImpedidos.motivo, vigenteDesde: proveedoresImpedidos.vigenteDesde,
        vigenteHasta: proveedoresImpedidos.vigenteHasta,
        razonSocial: proveedores.razonSocial, rfc: proveedores.rfc,
      }).from(proveedoresImpedidos)
        .leftJoin(proveedores, and(eq(proveedores.id, proveedoresImpedidos.proveedorId), eq(proveedores.tenantId, proveedoresImpedidos.tenantId)))
        .where(where).orderBy(desc(proveedoresImpedidos.createdAt)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(proveedoresImpedidos).where(where),
    ]);
    return pageResult(rows, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  documentosPublicos: publicQuery.input(z.object({
    tenantId: z.number().int().positive().optional(),
    licitacionId: z.number().int().positive().optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(50).optional(),
  }).optional()).query(async ({ input }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize ?? 20);
    // Public docs require APROBADO + esPublico + vigente (publishable phases preferred via procedimientos filter when listing procs).
    const conditions = [
      eq(documentos.esPublico, true),
      eq(documentos.esVersionVigente, true),
      eq(documentos.estado, "APROBADO"),
    ];
    if (input?.tenantId) conditions.push(eq(documentos.tenantId, input.tenantId));
    if (input?.licitacionId) conditions.push(eq(documentos.licitacionId, input.licitacionId));
    const where = and(...conditions);
    const db = getDb();
    const [rows, totalRows] = await Promise.all([
      db.select({
        id: documentos.id, tenantId: documentos.tenantId, licitacionId: documentos.licitacionId,
        tipo: documentos.tipo, nombreArchivo: documentos.nombreArchivo, version: documentos.version,
        fechaSubida: documentos.fechaSubida,
      }).from(documentos).where(where).orderBy(desc(documentos.fechaSubida)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(documentos).where(where),
    ]);
    return pageResult(rows, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  resumen: publicQuery.input(z.object({ tenantId: z.number().int().positive().optional() }).optional()).query(async ({ input }) => {
    const db = getDb();
    const tenantFilter = input?.tenantId ? eq(licitaciones.tenantId, input.tenantId) : undefined;
    const [pubs] = await db.select({ total: count() }).from(licitaciones).where(and(eq(licitaciones.estado, "PUBLICADA"), tenantFilter));
    const [adjs] = await db.select({ total: count() }).from(fallos).where(and(eq(fallos.estado, "PUBLICADO"), input?.tenantId ? eq(fallos.tenantId, input.tenantId) : undefined));
    const today = new Date().toISOString().slice(0, 10);
    const [imps] = await db.select({ total: count() }).from(proveedoresImpedidos).where(and(
      eq(proveedoresImpedidos.activo, true),
      sql`${proveedoresImpedidos.vigenteDesde} <= ${today}`,
      or(isNull(proveedoresImpedidos.vigenteHasta), sql`${proveedoresImpedidos.vigenteHasta} >= ${today}`),
      input?.tenantId ? eq(proveedoresImpedidos.tenantId, input.tenantId) : undefined,
    ));
    return {
      procedimientosPublicados: Number(pubs?.total ?? 0),
      adjudicacionesPublicadas: Number(adjs?.total ?? 0),
      proveedoresImpedidosActivos: Number(imps?.total ?? 0),
    };
  }),
});
