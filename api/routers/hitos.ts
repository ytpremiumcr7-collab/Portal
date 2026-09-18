import { z } from "zod";
import { and, eq, count, desc } from "drizzle-orm";
import { createRouter, convocanteQuery, adminQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { hitos, licitaciones } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { pageInput, pageResult } from "../lib/pagination";
import { assertLicitacionExists } from "../lib/domain";
import { findExpedienteByLicitacion } from "../lib/expediente";
import { writeAudit } from "../lib/security";

export const hitosRouter = createRouter({
  list: convocanteQuery.input(z.object({ licitacionId: z.number().int().positive().optional(), estado: z.enum(["PENDIENTE","EN_PROGRESO","COMPLETADO","CANCELADO","RETRASADO"]).optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize); const conditions = [eq(hitos.tenantId, ctx.user.tenantId)];
    if (input?.licitacionId) conditions.push(eq(hitos.licitacionId, input.licitacionId)); if (input?.estado) conditions.push(eq(hitos.estado, input.estado));
    const where = and(...conditions); const db = getDb(); const [items,totalRows] = await Promise.all([db.query.hitos.findMany({ where, orderBy: [desc(hitos.fechaProgramada)], limit: pageSize, offset, with: { licitacion: true } }), db.select({ total: count() }).from(hitos).where(where)]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getById: convocanteQuery.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const item = await getDb().query.hitos.findFirst({ where: and(eq(hitos.id, input.id), eq(hitos.tenantId, ctx.user.tenantId)), with: { licitacion: true } });
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Hito no encontrado." }); return item;
  }),

  create: convocanteQuery.input(z.object({ licitacionId: z.number().int().positive(), tipo: z.enum(["PUBLICACION","JUNTA_ACLARACIONES","PREGUNTAS_RESPUESTAS","MODIFICACION_PLIEGO","APERTURA_SOBRES","EVALUACION_TECNICA","EVALUACION_ECONOMICA","FALLO","ADJUDICACION","FIRMA_CONTRATO","INICIO_EJECUCION","ENTREGA","FINALIZACION"]), nombre: z.string().trim().min(3).max(150), descripcion: z.string().trim().optional(), fechaProgramada: z.string().datetime(), motivo: z.string().trim().optional() })).mutation(async ({ input, ctx }) => {
    await assertLicitacionExists(ctx.user.tenantId, input.licitacionId); const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId); if (!expediente) throw new TRPCError({code:"PRECONDITION_FAILED", message:"La licitación no tiene expediente electrónico."}); const db = getDb(); const result = await db.insert(hitos).values({ tenantId: ctx.user.tenantId, expedienteId: expediente.id, licitacionId: input.licitacionId, tipo: input.tipo, nombre: input.nombre, descripcion: input.descripcion ?? null, fechaProgramada: new Date(input.fechaProgramada), estado: "PENDIENTE", cumplido: false });
    const id = Number(result[0].insertId); const created = await db.query.hitos.findFirst({ where: and(eq(hitos.id,id),eq(hitos.tenantId,ctx.user.tenantId)) }); await writeAudit({ ctx: ctxForAudit(ctx), accion:"CREAR", entidad:"hitos", entidadId:id, valorNuevo:created, motivo:input.motivo }); return created;
  }),

  update: convocanteQuery.input(z.object({ id: z.number().int().positive(), nombre: z.string().trim().min(3).max(150).optional(), descripcion: z.string().trim().nullable().optional(), fechaProgramada: z.string().datetime().optional(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await db.query.hitos.findFirst({ where: and(eq(hitos.id,input.id),eq(hitos.tenantId,ctx.user.tenantId)) });
    if (!current) throw new TRPCError({ code:"NOT_FOUND",message:"Hito no encontrado." });
    if (["COMPLETADO","CANCELADO"].includes(current.estado)) throw new TRPCError({ code:"CONFLICT",message:"Un hito completado o cancelado ya no se puede editar." });
    const { id, motivo, ...data } = input;
    await db.update(hitos).set({ ...data, ...(data.fechaProgramada ? { fechaProgramada: new Date(data.fechaProgramada) } : {}) } as any).where(and(eq(hitos.id,id),eq(hitos.tenantId,ctx.user.tenantId)));
    const updated = await db.query.hitos.findFirst({ where: and(eq(hitos.id,id),eq(hitos.tenantId,ctx.user.tenantId)) });
    await writeAudit({ ctx:ctxForAudit(ctx),accion:"ACTUALIZAR",entidad:"hitos",entidadId:id,valorAnterior:current,valorNuevo:updated,motivo });
    return updated;
  }),

  completar: convocanteQuery.input(z.object({ id: z.number().int().positive(), estado: z.enum(["EN_PROGRESO","COMPLETADO","CANCELADO"]), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb(); const current = await db.query.hitos.findFirst({ where: and(eq(hitos.id,input.id),eq(hitos.tenantId,ctx.user.tenantId)) }); if (!current) throw new TRPCError({ code:"NOT_FOUND",message:"Hito no encontrado." });
    const allowed: Record<string,string[]> = { PENDIENTE:["EN_PROGRESO","COMPLETADO","CANCELADO"], EN_PROGRESO:["COMPLETADO","CANCELADO"], RETRASADO:["EN_PROGRESO","COMPLETADO","CANCELADO"] };
    if (!allowed[current.estado]?.includes(input.estado)) throw new TRPCError({ code:"CONFLICT",message:`Transición de hito no permitida: ${current.estado} → ${input.estado}.` });
    const completed = input.estado === "COMPLETADO"; await db.update(hitos).set({ estado: input.estado, cumplido: completed, fechaRealizada: completed ? new Date() : null }).where(and(eq(hitos.id,input.id),eq(hitos.tenantId,ctx.user.tenantId)));
    const updated = await db.query.hitos.findFirst({ where: and(eq(hitos.id,input.id),eq(hitos.tenantId,ctx.user.tenantId)) }); await writeAudit({ ctx:ctxForAudit(ctx),accion:"ACTUALIZAR",entidad:"hitos",entidadId:input.id,valorAnterior:current,valorNuevo:updated,motivo:input.motivo }); return updated;
  }),

  marcarRetrasados: adminQuery.input(z.object({}).default({})).mutation(async ({ ctx }) => {
    const db = getDb(); const now = new Date(); const due = await db.query.hitos.findMany({ where: and(eq(hitos.tenantId,ctx.user.tenantId),eq(hitos.estado,"PENDIENTE")) }); const late = due.filter(h=>h.fechaProgramada < now); for (const h of late) { await db.update(hitos).set({ estado:"RETRASADO" }).where(and(eq(hitos.id,h.id),eq(hitos.tenantId,ctx.user.tenantId))); await writeAudit({ctx:ctxForAudit(ctx),accion:"MARCAR_RETRASADO",entidad:"hitos",entidadId:h.id,valorAnterior:h,valorNuevo:{...h,estado:"RETRASADO"},motivo:"Control automático de vencimiento"}); } return { updated: late.length };
  }),

  delete: adminQuery.input(z.object({id:z.number().int().positive(),motivo:z.string().trim().min(3)})).mutation(async ({input,ctx})=>{const db=getDb(); const current=await db.query.hitos.findFirst({where:and(eq(hitos.id,input.id),eq(hitos.tenantId,ctx.user.tenantId))}); if(!current)throw new TRPCError({code:"NOT_FOUND",message:"Hito no encontrado."}); await db.delete(hitos).where(and(eq(hitos.id,input.id),eq(hitos.tenantId,ctx.user.tenantId))); await writeAudit({ctx:ctxForAudit(ctx),accion:"ELIMINAR",entidad:"hitos",entidadId:input.id,valorAnterior:current,motivo:input.motivo}); return {success:true};})
});
