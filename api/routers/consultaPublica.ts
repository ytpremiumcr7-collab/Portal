import { z } from "zod";
import { and, count, desc, eq, sql, or, isNull } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  licitaciones, fallos, contratos, documentos, proveedoresImpedidos, proveedores,
  programasAnuales, investigacionesMercado,
} from "@db/schema";
import { pageInput, pageResult } from "../lib/pagination";

/**
 * Public (unauthenticated) read surfaces — open-data style.
 * No admin/convocante auth required. Tenant scoped via optional tenantId or slug filter.
 */
export const consultaPublicaRouter = createRouter({
  procedimientos: publicQuery.input(z.object({
    tenantId: z.number().int().positive().optional(),
    q: z.string().trim().min(1).max(120).optional(),
    estado: z.string().trim().min(2).max(40).optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(50).optional(),
  }).optional()).query(async ({ input }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize ?? 20);
    const conditions = [sql`${licitaciones.estado} IN ('PUBLICADA','EN_EVALUACION','ADJUDICADA','FINALIZADA')`];
    if (input?.tenantId) conditions.push(eq(licitaciones.tenantId, input.tenantId));
    if (input?.estado) conditions.push(eq(licitaciones.estado, input.estado as any));
    if (input?.q) conditions.push(sql`(${licitaciones.codigo} LIKE ${"%" + input.q + "%"} OR ${licitaciones.titulo} LIKE ${"%" + input.q + "%"})`);
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
    // Public docs require APROBADO + esPublico + vigente AND related procedimiento in a publicable estado (not BORRADOR).
    const conditions = [
      eq(documentos.esPublico, true),
      eq(documentos.esVersionVigente, true),
      eq(documentos.estado, "APROBADO"),
      sql`${licitaciones.estado} IN ('PUBLICADA','EN_EVALUACION','ADJUDICADA','FINALIZADA','DESIERTA','CANCELADA')`,
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
      }).from(documentos)
        .innerJoin(licitaciones, and(eq(licitaciones.id, documentos.licitacionId), eq(licitaciones.tenantId, documentos.tenantId)))
        .where(where).orderBy(desc(documentos.fechaSubida)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(documentos)
        .innerJoin(licitaciones, and(eq(licitaciones.id, documentos.licitacionId), eq(licitaciones.tenantId, documentos.tenantId)))
        .where(where),
    ]);
    return pageResult(rows, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),


  procedimientoDetalle: publicQuery.input(z.object({
    id: z.number().int().positive(),
    tenantId: z.number().int().positive().optional(),
  })).query(async ({ input }) => {
    const db = getDb();
    const conditions = [
      eq(licitaciones.id, input.id),
      sql`${licitaciones.estado} IN ('PUBLICADA','EN_EVALUACION','ADJUDICADA','FINALIZADA')`,
    ];
    if (input.tenantId) conditions.push(eq(licitaciones.tenantId, input.tenantId));
    const [proc] = await db.select({
      id: licitaciones.id, tenantId: licitaciones.tenantId, codigo: licitaciones.codigo,
      titulo: licitaciones.titulo, objeto: licitaciones.objeto, estado: licitaciones.estado, etapa: licitaciones.etapa,
      tipoLicitacion: licitaciones.tipoLicitacion, tipoContratacion: licitaciones.tipoContratacion,
      montoPresupuestado: licitaciones.montoPresupuestado, fechaPublicacion: licitaciones.fechaPublicacion,
      fechaCierre: licitaciones.fechaCierre,
    }).from(licitaciones).where(and(...conditions)).limit(1);
    if (!proc) return null;
    const docs = await db.select({
      id: documentos.id, tipo: documentos.tipo, nombreArchivo: documentos.nombreArchivo, version: documentos.version,
      fechaSubida: documentos.fechaSubida,
    }).from(documentos).where(and(
      eq(documentos.tenantId, proc.tenantId), eq(documentos.licitacionId, proc.id),
      eq(documentos.esPublico, true), eq(documentos.esVersionVigente, true), eq(documentos.estado, "APROBADO"),
    ));
    const adj = await db.select({
      id: fallos.id, proveedorGanadorId: fallos.proveedorGanadorId, montoAdjudicado: fallos.montoAdjudicado,
      publicadoAt: fallos.publicadoAt,
    }).from(fallos).where(and(eq(fallos.tenantId, proc.tenantId), eq(fallos.licitacionId, proc.id), eq(fallos.estado, "PUBLICADO"))).limit(1);
    const ctr = await db.select({
      id: contratos.id, folio: contratos.folio, estado: contratos.estado, monto: contratos.monto, fechaFirma: contratos.fechaFirma,
    }).from(contratos).where(and(eq(contratos.tenantId, proc.tenantId), eq(contratos.licitacionId, proc.id))).limit(1);
    return { procedimiento: proc, documentosPublicos: docs.map((d: any) => ({ ...d, downloadUrl: `/api/public/documents/${d.id}` })), adjudicacion: adj[0] ?? null, contrato: ctr[0] ?? null };
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

  /** OCDS-like public projection for a procedure (ocid-like id). */
  ocdsRelease: publicQuery.input(z.object({
    id: z.number().int().positive(),
    tenantId: z.number().int().positive().optional(),
  })).query(async ({ input }) => {
    const db = getDb();
    const conditions = [
      eq(licitaciones.id, input.id),
      sql`${licitaciones.estado} IN ('PUBLICADA','EN_EVALUACION','ADJUDICADA','FINALIZADA','DESIERTA','CANCELADA')`,
    ];
    if (input.tenantId) conditions.push(eq(licitaciones.tenantId, input.tenantId));
    const [proc] = await db.select().from(licitaciones).where(and(...conditions)).limit(1);
    if (!proc) return null;
    const ocid = `ocds-ares-mx-${proc.tenantId}-${proc.codigo ?? proc.id}`;
    const adj = await db.select().from(fallos).where(and(eq(fallos.tenantId, proc.tenantId), eq(fallos.licitacionId, proc.id), eq(fallos.estado, "PUBLICADO"))).limit(1);
    const ctr = await db.select().from(contratos).where(and(eq(contratos.tenantId, proc.tenantId), eq(contratos.licitacionId, proc.id))).limit(1);
    return {
      ocid,
      id: `${ocid}-release-1`,
      date: proc.fechaPublicacion ?? proc.createdAt,
      tag: ["tender"],
      initiationType: "tender",
      planning: {
        budget: { amount: { amount: Number(proc.montoPresupuestado), currency: "MXN" } },
        rationale: proc.objeto,
      },
      tender: {
        id: proc.codigo,
        title: proc.titulo,
        description: proc.objeto,
        status: proc.estado,
        procurementMethod: proc.tipoLicitacion,
        procurementMethodDetails: proc.tipoContratacion,
        tenderPeriod: { startDate: proc.fechaPublicacion, endDate: proc.fechaCierre },
        value: { amount: Number(proc.montoPresupuestado), currency: "MXN" },
      },
      awards: adj[0] ? [{
        id: `award-${adj[0].id}`,
        status: "active",
        date: adj[0].publicadoAt,
        value: { amount: Number(adj[0].montoAdjudicado), currency: "MXN" },
        suppliers: [{ id: String(adj[0].proveedorGanadorId) }],
      }] : [],
      contracts: ctr[0] ? [{
        id: ctr[0].folio,
        awardID: adj[0] ? `award-${adj[0].id}` : undefined,
        status: ctr[0].estado,
        period: { startDate: ctr[0].fechaInicio, endDate: ctr[0].fechaFin },
        value: { amount: Number(ctr[0].monto), currency: "MXN" },
        dateSigned: ctr[0].fechaFirma,
      }] : [],
    };
  }),


  programasAnualesPublicos: publicQuery.input(z.object({
    tenantId: z.number().int().positive().optional(),
    anio: z.number().int().min(2000).max(2100).optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(50).optional(),
  }).optional()).query(async ({ input }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize ?? 20);
    const conditions = [sql`${programasAnuales.estado} IN ('APROBADO','PUBLICADO')`];
    if (input?.tenantId) conditions.push(eq(programasAnuales.tenantId, input.tenantId));
    if (input?.anio) conditions.push(eq(programasAnuales.anio, input.anio));
    const where = and(...conditions);
    const db = getDb();
    const [rows, totalRows] = await Promise.all([
      db.select({
        id: programasAnuales.id, tenantId: programasAnuales.tenantId, anio: programasAnuales.anio,
        nombre: programasAnuales.nombre, estado: programasAnuales.estado,
      }).from(programasAnuales).where(where).orderBy(desc(programasAnuales.anio)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(programasAnuales).where(where),
    ]);
    return pageResult(rows, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  investigacionesMercadoPublicas: publicQuery.input(z.object({
    tenantId: z.number().int().positive().optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(50).optional(),
  }).optional()).query(async ({ input }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize ?? 20);
    const conditions = [eq(investigacionesMercado.estado, "CONCLUIDA" as any)];
    if (input?.tenantId) conditions.push(eq(investigacionesMercado.tenantId, input.tenantId));
    const where = and(...conditions);
    const db = getDb();
    const [rows, totalRows] = await Promise.all([
      db.select({
        id: investigacionesMercado.id, tenantId: investigacionesMercado.tenantId,
        folio: investigacionesMercado.folio, objeto: investigacionesMercado.objeto,
        estado: investigacionesMercado.estado, resultado: investigacionesMercado.resultado,
      }).from(investigacionesMercado).where(where).orderBy(desc(investigacionesMercado.id)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(investigacionesMercado).where(where),
    ]);
    return pageResult(rows.map((r) => ({ ...r, resultadoPublicado: r.resultado ?? null })), Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

});
