import { z } from "zod";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, capabilityQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { investigacionesMercado, proveedoresConsultados, cotizacionesMercado } from "@db/schema";
import { fuentesMercado } from "@db/schema-institutional";
import { assertInvMercadoTransition } from "../lib/phase3-transitions";
import { assertNonNegativeDecimal, writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";
import {
  FUENTES_MERCADO,
  MODALIDADES_RECOMENDADAS,
  TIPOS_SOPORTE_FUENTE,
  assertEstudioListoParaCerrar,
  assertFuenteDocumento,
  assertLicitacionDelTenant,
  estadoInvestigacionParaLicitacion,
  listDocumentosSoporte,
  listFuentes,
  listFuentesConDocumento,
} from "../lib/investigacion-mercado";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido.");

async function loadInv(tenantId: number, id: number) {
  const item = await getDb().query.investigacionesMercado.findFirst({
    where: and(eq(investigacionesMercado.id, id), eq(investigacionesMercado.tenantId, tenantId)),
  });
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Investigación de mercado no encontrada." });
  return item;
}

function assertAbierta(estado: string) {
  if (!["BORRADOR", "EN_CONSULTA"].includes(estado)) {
    throw new TRPCError({ code: "CONFLICT", message: "El estudio ya no admite nuevas fuentes o identificaciones." });
  }
}

export const investigacionMercadoRouter = createRouter({
  list: authedQuery.input(z.object({
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(100).optional(),
    licitacionId: z.number().int().positive().optional(),
  }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(investigacionesMercado.tenantId, ctx.user.tenantId)];
    if (input?.licitacionId) conditions.push(eq(investigacionesMercado.licitacionId, input.licitacionId));
    const where = and(...conditions);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.investigacionesMercado.findMany({ where, orderBy: [desc(investigacionesMercado.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(investigacionesMercado).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getById: authedQuery.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const item = await getDb().query.investigacionesMercado.findFirst({
      where: and(eq(investigacionesMercado.id, input.id), eq(investigacionesMercado.tenantId, ctx.user.tenantId)),
      with: { consultados: { with: { cotizaciones: true } }, cotizaciones: true },
    });
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Investigación no encontrada." });
    const fuentes = await listFuentesConDocumento(ctx.user.tenantId, input.id);
    return {
      ...item,
      fuentes,
      aviso: "Las observaciones de precio no son proposiciones ni ofertas de participación.",
    };
  }),

  porLicitacion: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    return estadoInvestigacionParaLicitacion(ctx.user.tenantId, input.licitacionId);
  }),

  documentosSoporte: authedQuery.input(z.object({ investigacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const inv = await loadInv(ctx.user.tenantId, input.investigacionId);
    if (!inv.licitacionId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Vincule la licitación antes de elegir documentos de soporte. El expediente de la fuente es el de esa licitación.",
      });
    }
    const docs = await listDocumentosSoporte(ctx.user.tenantId, inv.licitacionId);
    const elegibles = docs.filter((d) => (TIPOS_SOPORTE_FUENTE as readonly string[]).includes(d.tipo) && d.estado !== "RECHAZADO" && d.estado !== "OBSOLETO");
    return {
      licitacionId: inv.licitacionId,
      tiposAceptados: TIPOS_SOPORTE_FUENTE,
      items: elegibles,
      aviso: "Cargue el oficio, captura CompraNet, tabulador o extracto como FUNDAMENTO_JURIDICO u OTRO en el expediente de la licitación. Una oferta no es fuente.",
    };
  }),

  crear: capabilityQuery("investigar_mercado").input(z.object({
    folio: z.string().trim().min(3).max(60), objeto: z.string().trim().min(10),
    marco: z.enum(["LAASSP", "LOPSRM"]).default("LAASSP"),
    necesidadId: z.number().int().positive().optional(), licitacionId: z.number().int().positive().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    if (input.licitacionId) await assertLicitacionDelTenant(ctx.user.tenantId, input.licitacionId);
    const result = await db.insert(investigacionesMercado).values({
      tenantId: ctx.user.tenantId, folio: input.folio, objeto: input.objeto, estado: "BORRADOR",
      necesidadId: input.necesidadId ?? null, licitacionId: input.licitacionId ?? null, creadaPor: ctx.user.id,
    });
    const id = Number(result[0].insertId);
    await db.execute(sql`UPDATE investigaciones_mercado SET marco = ${input.marco} WHERE tenant_id = ${ctx.user.tenantId} AND id = ${id}`);
    const created = await db.query.investigacionesMercado.findFirst({ where: and(eq(investigacionesMercado.id, id), eq(investigacionesMercado.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "investigaciones_mercado", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  vincularLicitacion: capabilityQuery("investigar_mercado").input(z.object({
    id: z.number().int().positive(),
    licitacionId: z.number().int().positive(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const inv = await loadInv(ctx.user.tenantId, input.id);
    if (inv.licitacionId && Number(inv.licitacionId) !== input.licitacionId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `El estudio ya está vinculado a la licitación #${inv.licitacionId}. Desvincular exige un acto posterior, no un overwrite silencioso.`,
      });
    }
    await assertLicitacionDelTenant(ctx.user.tenantId, input.licitacionId);
    await db.update(investigacionesMercado).set({ licitacionId: input.licitacionId } as any)
      .where(and(eq(investigacionesMercado.id, inv.id), eq(investigacionesMercado.tenantId, ctx.user.tenantId)));
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "VINCULAR_LICITACION", entidad: "investigaciones_mercado", entidadId: inv.id, motivo: input.motivo });
    return db.query.investigacionesMercado.findFirst({ where: and(eq(investigacionesMercado.id, inv.id), eq(investigacionesMercado.tenantId, ctx.user.tenantId)) });
  }),

  registrarFuente: capabilityQuery("investigar_mercado").input(z.object({
    investigacionId: z.number().int().positive(),
    tipo: z.enum(FUENTES_MERCADO),
    descripcion: z.string().trim().min(10),
    consultadaAt: z.string().datetime(),
    documentoId: z.number().int().positive(),
    urlOReferencia: z.string().trim().max(400).optional(),
    precioObservado: money.optional(),
    comparable: z.boolean().default(true),
    notasComparabilidad: z.string().trim().max(2000).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const inv = await loadInv(ctx.user.tenantId, input.investigacionId);
    assertAbierta(inv.estado);
    if (!inv.licitacionId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Vincule la licitación antes de registrar fuentes. El documento de soporte vive en el expediente de ese procedimiento.",
      });
    }
    await assertFuenteDocumento({
      tenantId: ctx.user.tenantId,
      documentoId: input.documentoId,
      licitacionId: inv.licitacionId,
    });
    if (input.precioObservado) assertNonNegativeDecimal(input.precioObservado, "precioObservado");
    const result = await db.insert(fuentesMercado).values({
      tenantId: ctx.user.tenantId, investigacionId: input.investigacionId, tipo: input.tipo,
      descripcion: input.descripcion, consultadaAt: new Date(input.consultadaAt), documentoId: input.documentoId,
      urlOReferencia: input.urlOReferencia ?? null, precioObservado: input.precioObservado ?? null,
      comparable: input.comparable, notasComparabilidad: input.notasComparabilidad ?? null, registradaPor: ctx.user.id,
    } as any);
    const id = Number(result[0].insertId);
    if (inv.estado === "BORRADOR") {
      assertInvMercadoTransition("BORRADOR", "EN_CONSULTA");
      await db.update(investigacionesMercado).set({ estado: "EN_CONSULTA" }).where(and(eq(investigacionesMercado.id, inv.id), eq(investigacionesMercado.tenantId, ctx.user.tenantId)));
    }
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "REGISTRAR_FUENTE", entidad: "fuentes_mercado", entidadId: id, motivo: input.motivo });
    return db.query.fuentesMercado.findFirst({ where: and(eq(fuentesMercado.id, id), eq(fuentesMercado.tenantId, ctx.user.tenantId)) });
  }),

  identificarPotencial: capabilityQuery("investigar_mercado").input(z.object({
    investigacionId: z.number().int().positive(),
    proveedorId: z.number().int().positive().optional(),
    razonSocialExterna: z.string().trim().min(2).max(200).optional(),
    fuente: z.string().trim().min(2).max(200),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const inv = await loadInv(ctx.user.tenantId, input.investigacionId);
    assertAbierta(inv.estado);
    if (!input.proveedorId && !input.razonSocialExterna) throw new TRPCError({ code: "BAD_REQUEST", message: "Identifique un proveedor del padrón o una razón social externa." });
    const result = await db.insert(proveedoresConsultados).values({
      tenantId: ctx.user.tenantId, investigacionId: input.investigacionId,
      proveedorId: input.proveedorId ?? null, razonSocialExterna: input.razonSocialExterna ?? null, fuente: input.fuente,
    });
    if (inv.estado === "BORRADOR") {
      assertInvMercadoTransition("BORRADOR", "EN_CONSULTA");
      await db.update(investigacionesMercado).set({ estado: "EN_CONSULTA" }).where(and(eq(investigacionesMercado.id, inv.id), eq(investigacionesMercado.tenantId, ctx.user.tenantId)));
    }
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "IDENTIFICAR_POTENCIAL", entidad: "proveedores_consultados", entidadId: Number(result[0].insertId), motivo: input.motivo });
    return db.query.proveedoresConsultados.findFirst({ where: and(eq(proveedoresConsultados.id, Number(result[0].insertId)), eq(proveedoresConsultados.tenantId, ctx.user.tenantId)) });
  }),

  consultarProveedor: capabilityQuery("investigar_mercado").input(z.object({
    investigacionId: z.number().int().positive(),
    proveedorId: z.number().int().positive().optional(),
    razonSocialExterna: z.string().trim().min(2).max(200).optional(),
    fuente: z.string().trim().min(2).max(200).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const inv = await loadInv(ctx.user.tenantId, input.investigacionId);
    assertAbierta(inv.estado);
    if (!input.proveedorId && !input.razonSocialExterna) throw new TRPCError({ code: "BAD_REQUEST", message: "Indique proveedor o razón social externa." });
    const result = await db.insert(proveedoresConsultados).values({
      tenantId: ctx.user.tenantId, investigacionId: input.investigacionId,
      proveedorId: input.proveedorId ?? null, razonSocialExterna: input.razonSocialExterna ?? null,
      fuente: input.fuente ?? "IDENTIFICACION_POTENCIAL",
    });
    if (inv.estado === "BORRADOR") {
      assertInvMercadoTransition("BORRADOR", "EN_CONSULTA");
      await db.update(investigacionesMercado).set({ estado: "EN_CONSULTA" }).where(and(eq(investigacionesMercado.id, inv.id), eq(investigacionesMercado.tenantId, ctx.user.tenantId)));
    }
    return db.query.proveedoresConsultados.findFirst({ where: and(eq(proveedoresConsultados.id, Number(result[0].insertId)), eq(proveedoresConsultados.tenantId, ctx.user.tenantId)) });
  }),

  registrarObservacionPrecio: capabilityQuery("investigar_mercado").input(z.object({
    investigacionId: z.number().int().positive(),
    potencialId: z.number().int().positive(),
    fuenteId: z.number().int().positive(),
    monto: money,
    documentoSoporteId: z.number().int().positive(),
    observaciones: z.string().trim().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    assertNonNegativeDecimal(input.monto, "monto");
    const db = getDb();
    const inv = await loadInv(ctx.user.tenantId, input.investigacionId);
    if (inv.estado !== "EN_CONSULTA") throw new TRPCError({ code: "CONFLICT", message: "Sólo en consulta se incorporan observaciones de precio (carácter informativo ≠ proposición)." });
    await assertFuenteDocumento({
      tenantId: ctx.user.tenantId,
      documentoId: input.documentoSoporteId,
      licitacionId: inv.licitacionId,
    });
    const fuente = await db.query.fuentesMercado.findFirst({ where: and(eq(fuentesMercado.id, input.fuenteId), eq(fuentesMercado.tenantId, ctx.user.tenantId), eq(fuentesMercado.investigacionId, input.investigacionId)) });
    if (!fuente) throw new TRPCError({ code: "BAD_REQUEST", message: "La observación debe anclarse a una fuente del estudio." });
    const potencial = await db.query.proveedoresConsultados.findFirst({ where: and(eq(proveedoresConsultados.id, input.potencialId), eq(proveedoresConsultados.tenantId, ctx.user.tenantId), eq(proveedoresConsultados.investigacionId, input.investigacionId)) });
    if (!potencial) throw new TRPCError({ code: "BAD_REQUEST", message: "El potencial no pertenece a este estudio." });
    const result = await db.insert(cotizacionesMercado).values({
      tenantId: ctx.user.tenantId, investigacionId: input.investigacionId,
      proveedorConsultadoId: input.potencialId, monto: input.monto, moneda: "MXN",
      observaciones: `INFORMATIVA fuente#${input.fuenteId}. ${input.observaciones ?? ""}`.trim(), estado: "RECIBIDA",
    } as any);
    const id = Number(result[0].insertId);
    await db.execute(sql`UPDATE cotizaciones_mercado SET procedencia = ${"SOLICITUD_INFORMATIVA"}, documento_soporte_id = ${input.documentoSoporteId} WHERE tenant_id = ${ctx.user.tenantId} AND id = ${id}`);
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "OBSERVACION_PRECIO", entidad: "cotizaciones_mercado", entidadId: id, motivo: input.motivo });
    return db.query.cotizacionesMercado.findFirst({ where: and(eq(cotizacionesMercado.id, id), eq(cotizacionesMercado.tenantId, ctx.user.tenantId)) });
  }),

  registrarCotizacion: capabilityQuery("investigar_mercado").input(z.object({
    investigacionId: z.number().int().positive(),
    proveedorConsultadoId: z.number().int().positive(),
    monto: money, observaciones: z.string().trim().optional(), motivo: z.string().trim().min(3),
  })).mutation(async () => {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Una cotización aislada no es investigación de mercado. Registre primero una fuente (registrarFuente) y, si aplica, una observación de precio informativa (registrarObservacionPrecio). Eso no constituye proposición.",
    });
  }),

  analisisPrecios: authedQuery.input(z.object({ investigacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const fuentes = await listFuentes(ctx.user.tenantId, input.investigacionId);
    const observados = fuentes.filter((f) => f.comparable && f.precioObservado != null).map((f) => Number(f.precioObservado)).filter((n) => Number.isFinite(n));
    return {
      caracter: "INFORMATIVO" as const, noEsProposiciones: true, fuentes: fuentes.length,
      tiposFuente: [...new Set(fuentes.map((f) => f.tipo))],
      min: observados.length ? Math.min(...observados) : null,
      max: observados.length ? Math.max(...observados) : null,
      avg: observados.length ? observados.reduce((a, b) => a + b, 0) / observados.length : null,
      count: observados.length,
    };
  }),

  comparativo: authedQuery.input(z.object({ investigacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const fuentes = await listFuentes(ctx.user.tenantId, input.investigacionId);
    const observados = fuentes.filter((f) => f.comparable && f.precioObservado != null).map((f) => Number(f.precioObservado)).filter((n) => Number.isFinite(n));
    return {
      caracter: "INFORMATIVO" as const, noEsProposiciones: true,
      min: observados.length ? Math.min(...observados) : null,
      max: observados.length ? Math.max(...observados) : null,
      avg: observados.length ? observados.reduce((a, b) => a + b, 0) / observados.length : null,
      count: observados.length,
    };
  }),

  validarCotizacion: capabilityQuery("investigar_mercado").input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async () => {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No se validan cotizaciones como ofertas. Use incorporarObservacion para el precio prevaleciente." });
  }),

  incorporarObservacion: capabilityQuery("investigar_mercado").input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await db.query.cotizacionesMercado.findFirst({ where: and(eq(cotizacionesMercado.id, input.id), eq(cotizacionesMercado.tenantId, ctx.user.tenantId)) });
    if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Observación no encontrada." });
    if (cur.estado !== "RECIBIDA") throw new TRPCError({ code: "CONFLICT", message: "Sólo observaciones RECIBIDA pueden incorporarse al análisis de precio prevaleciente." });
    await db.update(cotizacionesMercado).set({ estado: "VALIDADA" } as any).where(and(eq(cotizacionesMercado.id, input.id), eq(cotizacionesMercado.tenantId, ctx.user.tenantId), eq(cotizacionesMercado.estado, "RECIBIDA")));
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "INCORPORAR_OBSERVACION", entidad: "cotizaciones_mercado", entidadId: input.id, motivo: input.motivo });
    return db.query.cotizacionesMercado.findFirst({ where: and(eq(cotizacionesMercado.id, input.id), eq(cotizacionesMercado.tenantId, ctx.user.tenantId)) });
  }),

  descartarCotizacion: capabilityQuery("investigar_mercado").input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await db.query.cotizacionesMercado.findFirst({ where: and(eq(cotizacionesMercado.id, input.id), eq(cotizacionesMercado.tenantId, ctx.user.tenantId)) });
    if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Observación no encontrada." });
    await db.update(cotizacionesMercado).set({ estado: "DESCARTADA" } as any).where(and(eq(cotizacionesMercado.id, input.id), eq(cotizacionesMercado.tenantId, ctx.user.tenantId)));
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "DESCARTAR_OBSERVACION", entidad: "cotizaciones_mercado", entidadId: input.id, motivo: input.motivo });
    return db.query.cotizacionesMercado.findFirst({ where: and(eq(cotizacionesMercado.id, input.id), eq(cotizacionesMercado.tenantId, ctx.user.tenantId)) });
  }),

  transicionar: capabilityQuery("investigar_mercado").input(z.object({
    id: z.number().int().positive(),
    to: z.enum(["EN_CONSULTA", "CERRADA", "CONCLUIDA", "CANCELADA"]),
    resultado: z.string().trim().min(5).optional(),
    conclusion: z.string().trim().min(5).optional(),
    precioReferencia: money.optional(),
    existenciaOferta: z.boolean().optional(),
    potencialesIdentificados: z.number().int().nonnegative().optional(),
    modalidadRecomendada: z.enum(MODALIDADES_RECOMENDADAS).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await loadInv(ctx.user.tenantId, input.id);
    assertInvMercadoTransition(cur.estado as any, input.to);
    if (input.to === "CERRADA" || input.to === "CONCLUIDA") {
      const fuentes = await listFuentes(ctx.user.tenantId, input.id);
      assertEstudioListoParaCerrar({
        licitacionId: cur.licitacionId,
        fuentes: fuentes.map((f) => ({ tipo: f.tipo, documentoId: f.documentoId })),
      });
    }
    if (input.to === "CONCLUIDA") {
      if (!input.conclusion || !input.resultado || !input.precioReferencia || input.existenciaOferta == null || input.potencialesIdentificados == null || !input.modalidadRecomendada) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Concluir el estudio exige resultado, conclusión motivada, precio estimado, existencia de oferta, número de potenciales y modalidad recomendada." });
      }
    }
    const patch: Record<string, unknown> = { estado: input.to };
    if (input.resultado) patch.resultado = input.resultado;
    if (input.conclusion) patch.conclusion = input.conclusion;
    if (input.precioReferencia) { assertNonNegativeDecimal(input.precioReferencia, "precioReferencia"); patch.precioReferencia = input.precioReferencia; }
    if (input.to === "CONCLUIDA") patch.concluidaAt = new Date();
    await db.update(investigacionesMercado).set(patch as any).where(and(eq(investigacionesMercado.id, input.id), eq(investigacionesMercado.tenantId, ctx.user.tenantId), eq(investigacionesMercado.estado, cur.estado)));
    if (input.to === "CONCLUIDA") {
      await db.execute(sql`UPDATE investigaciones_mercado SET existencia_oferta = ${input.existenciaOferta ? 1 : 0}, potenciales_identificados = ${input.potencialesIdentificados ?? 0}, modalidad_recomendada = ${input.modalidadRecomendada ?? null} WHERE tenant_id = ${ctx.user.tenantId} AND id = ${input.id}`);
    }
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "TRANSICION_IM", entidad: "investigaciones_mercado", entidadId: input.id, motivo: input.motivo });
    return db.query.investigacionesMercado.findFirst({ where: and(eq(investigacionesMercado.id, input.id), eq(investigacionesMercado.tenantId, ctx.user.tenantId)) });
  }),
});
