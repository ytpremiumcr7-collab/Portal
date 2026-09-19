import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, capabilityQuery, authedQuery, ctxForAudit } from "../middleware";
import { assertProcedimientoAsignacion } from "../lib/sod";
import { getDb } from "../queries/connection";
import { comisionEvaluadora, coiDeclaraciones, users } from "@db/schema";
import { assertLicitacionExists } from "../lib/domain";
import { writeAudit } from "../lib/security";

export const comisionRouter = createRouter({
  list: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    return getDb().query.comisionEvaluadora.findMany({
      where: and(eq(comisionEvaluadora.tenantId, ctx.user.tenantId), eq(comisionEvaluadora.licitacionId, input.licitacionId)),
    });
  }),

  designar: capabilityQuery("crear_procedimiento").input(z.object({
    licitacionId: z.number().int().positive(),
    userId: z.number().int().positive(),
    rol: z.enum(["PRESIDENTE", "SECRETARIO", "VOCAL_TECNICO", "VOCAL_ECONOMICO", "VOCAL"]).default("VOCAL"),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    await assertProcedimientoAsignacion(ctx.user, input.licitacionId, "creador");
    const db = getDb();
    const u = await db.query.users.findFirst({ where: and(eq(users.id, input.userId), eq(users.tenantId, ctx.user.tenantId), eq(users.activo, true)) });
    if (!u) throw new TRPCError({ code: "BAD_REQUEST", message: "Usuario no válido." });
    const result = await db.insert(comisionEvaluadora).values({
      tenantId: ctx.user.tenantId, licitacionId: input.licitacionId, userId: input.userId,
      rol: input.rol, activa: true, designadoPor: ctx.user.id,
    } as any);
    const id = Number(result[0].insertId);
    const created = await db.query.comisionEvaluadora.findFirst({ where: and(eq(comisionEvaluadora.id, id), eq(comisionEvaluadora.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "DESIGNAR", entidad: "comision_evaluadora", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  declararCoi: authedQuery.input(z.object({
    licitacionId: z.number().int().positive(),
    comisionMiembroId: z.number().int().positive(),
    tieneConflicto: z.boolean(),
    descripcion: z.string().trim().min(5),
    proveedorId: z.number().int().positive().optional(),
    recusado: z.boolean().default(false),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const miembro = await db.query.comisionEvaluadora.findFirst({
      where: and(eq(comisionEvaluadora.id, input.comisionMiembroId), eq(comisionEvaluadora.tenantId, ctx.user.tenantId), eq(comisionEvaluadora.licitacionId, input.licitacionId)),
    });
    if (!miembro) throw new TRPCError({ code: "NOT_FOUND", message: "Miembro de comisión no encontrado." });
    if (miembro.userId !== ctx.user.id && ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Sólo el miembro (o admin) declara su COI." });
    }
    if (input.tieneConflicto && !input.recusado) {
      // Allowed to declare without recusal — but evaluar will gate.
    }
    const result = await db.insert(coiDeclaraciones).values({
      tenantId: ctx.user.tenantId, licitacionId: input.licitacionId, comisionMiembroId: input.comisionMiembroId,
      userId: miembro.userId, proveedorId: input.proveedorId ?? null,
      tieneConflicto: input.tieneConflicto, descripcion: input.descripcion, recusado: input.recusado,
    } as any);
    const id = Number(result[0].insertId);
    const created = await db.query.coiDeclaraciones.findFirst({ where: and(eq(coiDeclaraciones.id, id), eq(coiDeclaraciones.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "DECLARAR_COI", entidad: "coi_declaraciones", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  listCoi: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    return getDb().query.coiDeclaraciones.findMany({
      where: and(eq(coiDeclaraciones.tenantId, ctx.user.tenantId), eq(coiDeclaraciones.licitacionId, input.licitacionId)),
    });
  }),
});
