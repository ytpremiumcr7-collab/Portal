import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import {
  procedimientoAsignaciones, capabilityIncompatibilidades, licitaciones, users,
} from "@db/schema";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import {
  PROCEDIMIENTO_ROLES, isProcedimientoRole, assertNoRoleConflict, DEFAULT_ROLE_INCOMPATIBILIDADES,
} from "../lib/sod";
import { writeAudit } from "../lib/security";

export const sodRouter = createRouter({
  rolesCatalog: authedQuery.query(() => ({
    roles: PROCEDIMIENTO_ROLES,
    defaultIncompatibilidades: DEFAULT_ROLE_INCOMPATIBILIDADES.map(([a, b, motivo]) => ({ a, b, motivo })),
  })),

  listIncompatibilidades: authedQuery.query(async () => {
    const rows = await getDb().select().from(capabilityIncompatibilidades).where(eq(capabilityIncompatibilidades.activa, true));
    return { capabilities: rows, roles: DEFAULT_ROLE_INCOMPATIBILIDADES.map(([a, b, motivo]) => ({ a, b, motivo })) };
  }),

  listAsignaciones: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    return getDb().query.procedimientoAsignaciones.findMany({
      where: and(
        eq(procedimientoAsignaciones.tenantId, ctx.user.tenantId),
        eq(procedimientoAsignaciones.licitacionId, input.licitacionId),
      ),
      orderBy: [desc(procedimientoAsignaciones.createdAt)],
    });
  }),

  asignar: adminQuery.input(z.object({
    licitacionId: z.number().int().positive(),
    userId: z.number().int().positive(),
    rol: z.string().trim().min(2),
    overrideSod: z.boolean().default(false),
    justificacionOverride: z.string().trim().min(10).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    if (!isProcedimientoRole(input.rol)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Rol de procedimiento desconocido: ${input.rol}` });
    }
    const db = getDb();
    const lic = await db.query.licitaciones.findFirst({
      where: and(eq(licitaciones.id, input.licitacionId), eq(licitaciones.tenantId, ctx.user.tenantId)),
    });
    if (!lic) throw new TRPCError({ code: "NOT_FOUND", message: "Licitación no encontrada." });
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, input.userId), eq(users.tenantId, ctx.user.tenantId)),
    });
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado." });

    const existing = await db.query.procedimientoAsignaciones.findMany({
      where: and(
        eq(procedimientoAsignaciones.tenantId, ctx.user.tenantId),
        eq(procedimientoAsignaciones.licitacionId, input.licitacionId),
        eq(procedimientoAsignaciones.userId, input.userId),
      ),
    });
    assertNoRoleConflict(
      existing.map((e) => e.rol),
      input.rol,
      { override: input.overrideSod, justification: input.justificacionOverride },
    );

    const dup = existing.find((e) => e.rol === input.rol);
    if (dup) throw new TRPCError({ code: "CONFLICT", message: "El usuario ya tiene ese rol en el procedimiento." });

    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    let id = 0;
    await db.transaction(async (tx) => {
      const result = await tx.insert(procedimientoAsignaciones).values({
        tenantId: ctx.user.tenantId,
        licitacionId: input.licitacionId,
        userId: input.userId,
        rol: input.rol,
        overrideSod: input.overrideSod,
        justificacionOverride: input.overrideSod ? (input.justificacionOverride ?? null) : null,
        asignadoPor: ctx.user.id,
      });
      id = Number(result[0].insertId);
      if (expediente) {
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: expediente.id,
          tipo: input.overrideSod ? "SOD_OVERRIDE_ASIGNACION" : "SOD_ASIGNACION",
          estadoAnterior: null,
          estadoNuevo: input.rol,
          motivo: input.overrideSod
            ? `${input.motivo} | OVERRIDE: ${input.justificacionOverride}`
            : input.motivo,
          payload: {
            asignacionId: id, userId: input.userId, rol: input.rol,
            overrideSod: input.overrideSod, justificacionOverride: input.justificacionOverride ?? null,
          },
        });
      }
    });
    const created = await db.query.procedimientoAsignaciones.findFirst({
      where: and(eq(procedimientoAsignaciones.id, id), eq(procedimientoAsignaciones.tenantId, ctx.user.tenantId)),
    });
    await writeAudit({
      ctx: ctxForAudit(ctx), accion: input.overrideSod ? "SOD_OVERRIDE" : "SOD_ASIGNAR",
      entidad: "procedimiento_asignaciones", entidadId: id, valorNuevo: created, motivo: input.motivo,
    });
    return created;
  }),

  revocar: adminQuery.input(z.object({
    id: z.number().int().positive(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await db.query.procedimientoAsignaciones.findFirst({
      where: and(eq(procedimientoAsignaciones.id, input.id), eq(procedimientoAsignaciones.tenantId, ctx.user.tenantId)),
    });
    if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Asignación no encontrada." });
    await db.delete(procedimientoAsignaciones).where(and(
      eq(procedimientoAsignaciones.id, input.id), eq(procedimientoAsignaciones.tenantId, ctx.user.tenantId),
    ));
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, cur.licitacionId);
    if (expediente) {
      await db.transaction(async (tx) => {
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: expediente.id, tipo: "SOD_REVOCACION",
          estadoAnterior: cur.rol, estadoNuevo: null, motivo: input.motivo,
          payload: { asignacionId: cur.id, userId: cur.userId, rol: cur.rol },
        });
      });
    }
    await writeAudit({
      ctx: ctxForAudit(ctx), accion: "SOD_REVOCAR", entidad: "procedimiento_asignaciones",
      entidadId: input.id, valorAnterior: cur, motivo: input.motivo,
    });
    return { success: true };
  }),
});
