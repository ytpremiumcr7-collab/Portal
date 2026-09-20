import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, capabilityQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import {
  programasAnuales, partidasPresupuestarias, necesidades, suficienciasPresupuestarias,
  estrategiasProcedimiento, licitaciones, entidades,
} from "@db/schema";
import { assertNecesidadTransition, assertSuficienciaParaVincular } from "../lib/phase3-transitions";
import { assertNonNegativeDecimal, writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";
import { moneySub, moneyAdd, moneyFixed2, moneyGt } from "../lib/money";
import { nextLicitacionCode } from "../lib/domain";
import { createExpedienteForLicitacion as createExp } from "../lib/expediente";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido.");

export const planeacionRouter = createRouter({
  listProgramas: authedQuery.input(z.object({ page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const where = eq(programasAnuales.tenantId, ctx.user.tenantId);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.programasAnuales.findMany({ where, orderBy: [desc(programasAnuales.anio)], limit: pageSize, offset, with: { partidas: true } }),
      db.select({ total: count() }).from(programasAnuales).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  crearPrograma: capabilityQuery("administrar_planeacion").input(z.object({
    entidadId: z.number().int().positive(), anio: z.number().int().min(2000).max(2100),
    nombre: z.string().trim().min(3).max(200), motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const ent = await db.query.entidades.findFirst({ where: and(eq(entidades.id, input.entidadId), eq(entidades.tenantId, ctx.user.tenantId)) });
    if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "Entidad no encontrada." });
    const result = await db.insert(programasAnuales).values({
      tenantId: ctx.user.tenantId, entidadId: input.entidadId, anio: input.anio, nombre: input.nombre, estado: "BORRADOR",
    });
    const id = Number(result[0].insertId);
    const created = await db.query.programasAnuales.findFirst({ where: and(eq(programasAnuales.id, id), eq(programasAnuales.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "programas_anuales", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  aprobarPrograma: capabilityQuery("administrar_planeacion").input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await db.query.programasAnuales.findFirst({ where: and(eq(programasAnuales.id, input.id), eq(programasAnuales.tenantId, ctx.user.tenantId)) });
    if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Programa no encontrado." });
    if (cur.estado !== "BORRADOR") throw new TRPCError({ code: "CONFLICT", message: "Sólo BORRADOR puede aprobarse." });
    await db.update(programasAnuales).set({ estado: "APROBADO" }).where(and(eq(programasAnuales.id, input.id), eq(programasAnuales.tenantId, ctx.user.tenantId)));
    return db.query.programasAnuales.findFirst({ where: and(eq(programasAnuales.id, input.id), eq(programasAnuales.tenantId, ctx.user.tenantId)) });
  }),

  agregarPartida: capabilityQuery("administrar_planeacion").input(z.object({
    programaId: z.number().int().positive(), codigo: z.string().trim().min(1).max(40),
    descripcion: z.string().trim().min(3).max(300), montoAsignado: money,
    fuenteFinanciamiento: z.enum(["RECURSOS_FISCALES", "RECURSOS_PROPIOS", "CREDITO", "FIDEICOMISO", "FEDERAL_ETIQUETADO", "OTRO"]),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    assertNonNegativeDecimal(input.montoAsignado, "montoAsignado");
    const db = getDb();
    const prog = await db.query.programasAnuales.findFirst({ where: and(eq(programasAnuales.id, input.programaId), eq(programasAnuales.tenantId, ctx.user.tenantId)) });
    if (!prog) throw new TRPCError({ code: "NOT_FOUND", message: "Programa no encontrado." });
    const result = await db.insert(partidasPresupuestarias).values({
      tenantId: ctx.user.tenantId, programaId: input.programaId, codigo: input.codigo, descripcion: input.descripcion,
      montoAsignado: input.montoAsignado, montoComprometido: "0.00", fuenteFinanciamiento: input.fuenteFinanciamiento,
    });
    const id = Number(result[0].insertId);
    const created = await db.query.partidasPresupuestarias.findFirst({ where: and(eq(partidasPresupuestarias.id, id), eq(partidasPresupuestarias.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "partidas_presupuestarias", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  listNecesidades: authedQuery.input(z.object({ page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const where = eq(necesidades.tenantId, ctx.user.tenantId);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.necesidades.findMany({ where, orderBy: [desc(necesidades.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(necesidades).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  crearNecesidad: capabilityQuery("administrar_planeacion").input(z.object({
    entidadId: z.number().int().positive(), partidaId: z.number().int().positive().optional(),
    folio: z.string().trim().min(3).max(60), titulo: z.string().trim().min(5).max(300),
    descripcion: z.string().trim().min(10), justificacion: z.string().trim().min(10),
    montoEstimado: money, tipoContratacion: z.enum(["OBRA", "SERVICIO", "BIENES", "CONCESION", "ARRENDAMIENTO"]),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    assertNonNegativeDecimal(input.montoEstimado, "montoEstimado");
    const db = getDb();
    const result = await db.insert(necesidades).values({
      tenantId: ctx.user.tenantId, entidadId: input.entidadId, partidaId: input.partidaId ?? null,
      folio: input.folio, titulo: input.titulo, descripcion: input.descripcion, justificacion: input.justificacion,
      estado: "BORRADOR", montoEstimado: input.montoEstimado, tipoContratacion: input.tipoContratacion, creadaPor: ctx.user.id,
    } as any);
    const id = Number(result[0].insertId);
    const created = await db.query.necesidades.findFirst({ where: and(eq(necesidades.id, id), eq(necesidades.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "necesidades", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  transicionarNecesidad: capabilityQuery("administrar_planeacion").input(z.object({
    id: z.number().int().positive(),
    to: z.enum(["EN_REVISION", "APROBADA", "RECHAZADA"]),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await db.query.necesidades.findFirst({ where: and(eq(necesidades.id, input.id), eq(necesidades.tenantId, ctx.user.tenantId)) });
    if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Necesidad no encontrada." });
    assertNecesidadTransition(cur.estado as any, input.to);
    const patch: Record<string, unknown> = { estado: input.to };
    if (input.to === "APROBADA") { patch.aprobadaPor = ctx.user.id; patch.aprobadaAt = new Date(); }
    await db.update(necesidades).set(patch as any).where(and(eq(necesidades.id, input.id), eq(necesidades.tenantId, ctx.user.tenantId), eq(necesidades.estado, cur.estado)));
    const updated = await db.query.necesidades.findFirst({ where: and(eq(necesidades.id, input.id), eq(necesidades.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "TRANSICION", entidad: "necesidades", entidadId: input.id, valorAnterior: cur, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),

  solicitarSuficiencia: capabilityQuery("administrar_planeacion").input(z.object({
    necesidadId: z.number().int().positive(), partidaId: z.number().int().positive(),
    monto: money, folio: z.string().trim().min(3).max(60), motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    assertNonNegativeDecimal(input.monto, "monto");
    const db = getDb();
    const nec = await db.query.necesidades.findFirst({ where: and(eq(necesidades.id, input.necesidadId), eq(necesidades.tenantId, ctx.user.tenantId)) });
    if (!nec) throw new TRPCError({ code: "NOT_FOUND", message: "Necesidad no encontrada." });
    const result = await db.insert(suficienciasPresupuestarias).values({
      tenantId: ctx.user.tenantId, necesidadId: input.necesidadId, partidaId: input.partidaId,
      monto: input.monto, estado: "SOLICITADA", folio: input.folio,
    });
    const id = Number(result[0].insertId);
    return db.query.suficienciasPresupuestarias.findFirst({ where: and(eq(suficienciasPresupuestarias.id, id), eq(suficienciasPresupuestarias.tenantId, ctx.user.tenantId)) });
  }),

  otorgarSuficiencia: capabilityQuery("administrar_planeacion").input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await db.query.suficienciasPresupuestarias.findFirst({ where: and(eq(suficienciasPresupuestarias.id, input.id), eq(suficienciasPresupuestarias.tenantId, ctx.user.tenantId)) });
    if (!cur || cur.estado !== "SOLICITADA") throw new TRPCError({ code: "CONFLICT", message: "Suficiencia no solicitada." });
    await db.transaction(async (tx) => {
      // Lock partida row before commit to prevent concurrent over-commitment.
      const locked = await tx.select().from(partidasPresupuestarias)
        .where(and(eq(partidasPresupuestarias.id, cur.partidaId), eq(partidasPresupuestarias.tenantId, ctx.user.tenantId)))
        .for("update")
        .limit(1);
      const partida = locked[0];
      if (!partida) throw new TRPCError({ code: "NOT_FOUND", message: "Partida no encontrada." });
      const disponible = moneyFixed2(moneySub(partida.montoAsignado, partida.montoComprometido));
      if (moneyGt(cur.monto, disponible)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Disponibilidad presupuestaria insuficiente." });
      const upd = await tx.update(suficienciasPresupuestarias).set({ estado: "OTORGADA", otorgadaPor: ctx.user.id, otorgadaAt: new Date() })
        .where(and(eq(suficienciasPresupuestarias.id, input.id), eq(suficienciasPresupuestarias.tenantId, ctx.user.tenantId), eq(suficienciasPresupuestarias.estado, "SOLICITADA")));
      if (Number(upd[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "La suficiencia cambió de estado." });
      await tx.update(partidasPresupuestarias).set({ montoComprometido: moneyFixed2(moneyAdd(partida.montoComprometido, cur.monto)) } as any)
        .where(and(eq(partidasPresupuestarias.id, partida.id), eq(partidasPresupuestarias.tenantId, ctx.user.tenantId)));
    });
    return db.query.suficienciasPresupuestarias.findFirst({ where: and(eq(suficienciasPresupuestarias.id, input.id), eq(suficienciasPresupuestarias.tenantId, ctx.user.tenantId)) });
  }),

  definirEstrategia: capabilityQuery("administrar_planeacion").input(z.object({
    necesidadId: z.number().int().positive(),
    modalidad: z.enum(["LICITACION_PUBLICA", "INVITACION_RESTRINGIDA", "ADJUDICACION_DIRECTA"]),
    justificacionModalidad: z.string().trim().min(10), procedencia: z.string().trim().min(10),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const nec = await db.query.necesidades.findFirst({ where: and(eq(necesidades.id, input.necesidadId), eq(necesidades.tenantId, ctx.user.tenantId)) });
    if (!nec || nec.estado !== "APROBADA") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Necesidad debe estar APROBADA." });
    const result = await db.insert(estrategiasProcedimiento).values({
      tenantId: ctx.user.tenantId, necesidadId: input.necesidadId, modalidad: input.modalidad,
      justificacionModalidad: input.justificacionModalidad, procedencia: input.procedencia,
      estado: "APROBADA", creadaPor: ctx.user.id,
    });
    const id = Number(result[0].insertId);
    return db.query.estrategiasProcedimiento.findFirst({ where: and(eq(estrategiasProcedimiento.id, id), eq(estrategiasProcedimiento.tenantId, ctx.user.tenantId)) });
  }),

  vincularALicitacion: capabilityQuery("crear_procedimiento").input(z.object({
    necesidadId: z.number().int().positive(),
    categoriaId: z.number().int().positive(),
    titulo: z.string().trim().min(5).max(300).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const nec = await db.query.necesidades.findFirst({ where: and(eq(necesidades.id, input.necesidadId), eq(necesidades.tenantId, ctx.user.tenantId)) });
    if (!nec) throw new TRPCError({ code: "NOT_FOUND", message: "Necesidad no encontrada." });
    if (nec.estado !== "APROBADA") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Necesidad debe estar APROBADA." });
    const suf = await db.query.suficienciasPresupuestarias.findFirst({
      where: and(eq(suficienciasPresupuestarias.tenantId, ctx.user.tenantId), eq(suficienciasPresupuestarias.necesidadId, input.necesidadId)),
      orderBy: [desc(suficienciasPresupuestarias.id)],
    });
    assertSuficienciaParaVincular(suf?.estado);
    const estrategia = await db.query.estrategiasProcedimiento.findFirst({
      where: and(eq(estrategiasProcedimiento.tenantId, ctx.user.tenantId), eq(estrategiasProcedimiento.necesidadId, input.necesidadId)),
    });
    if (!estrategia || estrategia.estado === "BORRADOR") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Se requiere estrategia de procedimiento aprobada." });
    let licId = 0;
    await db.transaction(async (tx) => {
      const codigo = await nextLicitacionCode(ctx.user.tenantId, tx);
      const result = await tx.insert(licitaciones).values({
        tenantId: ctx.user.tenantId, codigo, titulo: input.titulo ?? nec.titulo, objeto: nec.descripcion,
        estado: "BORRADOR", etapa: "PREPARACION", entidadId: nec.entidadId, categoriaId: input.categoriaId,
        convocanteId: ctx.user.id, tipoLicitacion: estrategia.modalidad, tipoContratacion: nec.tipoContratacion as any,
        montoPresupuestado: nec.montoEstimado, moneda: "MXN",
      } as any);
      licId = Number(result[0].insertId);
      const lic = { id: licId, codigo, tipoContratacion: nec.tipoContratacion };
      await createExp(tx, ctx, lic as any);
      assertNecesidadTransition(nec.estado as any, "VINCULADA");
      await tx.update(necesidades).set({ estado: "VINCULADA" }).where(and(eq(necesidades.id, nec.id), eq(necesidades.tenantId, ctx.user.tenantId)));
      await tx.update(estrategiasProcedimiento).set({ estado: "APLICADA", licitacionId: licId }).where(and(eq(estrategiasProcedimiento.id, estrategia.id), eq(estrategiasProcedimiento.tenantId, ctx.user.tenantId)));
      if (suf) await tx.update(suficienciasPresupuestarias).set({ estado: "COMPROMETIDA" }).where(and(eq(suficienciasPresupuestarias.id, suf.id), eq(suficienciasPresupuestarias.tenantId, ctx.user.tenantId)));
    });
    const lic = await db.query.licitaciones.findFirst({ where: and(eq(licitaciones.id, licId), eq(licitaciones.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "VINCULAR", entidad: "necesidades", entidadId: nec.id, valorNuevo: { necesidadId: nec.id, licitacionId: licId }, motivo: input.motivo });
    return { necesidad: nec, licitacion: lic };
  }),
});
