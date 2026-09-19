import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery, capabilityQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import {
  procedimientoAsignaciones, capabilityIncompatibilidades, licitaciones, users, breakGlassGrants,
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

    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    let id = 0;
    // check+insert in same TX with FOR UPDATE lock on existing assignments for this procedimiento/user
    await db.transaction(async (tx) => {
      const existing = await tx.select()
        .from(procedimientoAsignaciones)
        .where(and(
          eq(procedimientoAsignaciones.tenantId, ctx.user.tenantId),
          eq(procedimientoAsignaciones.licitacionId, input.licitacionId),
          eq(procedimientoAsignaciones.userId, input.userId),
        ))
        .for("update");

      assertNoRoleConflict(
        existing.map((e) => e.rol),
        input.rol,
        { override: input.overrideSod, justification: input.justificacionOverride },
      );

      const dup = existing.find((e) => e.rol === input.rol);
      if (dup) throw new TRPCError({ code: "CONFLICT", message: "El usuario ya tiene ese rol en el procedimiento." });

      const result = await tx.insert(procedimientoAsignaciones).values({
        tenantId: ctx.user.tenantId,
        licitacionId: input.licitacionId,
        userId: input.userId,
        rol: input.rol,
        overrideSod: input.overrideSod,
        // Persist SoD override justification on grant (column + expediente event payload).
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
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, cur.licitacionId);
    // DELETE + expediente event SAME transaction
    await db.transaction(async (tx) => {
      await tx.delete(procedimientoAsignaciones).where(and(
        eq(procedimientoAsignaciones.id, input.id), eq(procedimientoAsignaciones.tenantId, ctx.user.tenantId),
      ));
      if (expediente) {
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: expediente.id, tipo: "SOD_REVOCACION",
          estadoAnterior: cur.rol, estadoNuevo: null, motivo: input.motivo,
          payload: { asignacionId: cur.id, userId: cur.userId, rol: cur.rol },
        });
      }
    });
    await writeAudit({
      ctx: ctxForAudit(ctx), accion: "SOD_REVOCAR", entidad: "procedimiento_asignaciones",
      entidadId: input.id, valorAnterior: cur, motivo: input.motivo,
    });
    return { success: true };
  }),

  listBreakGlass: adminQuery.input(z.object({
    userId: z.number().int().positive().optional(),
    licitacionId: z.number().int().positive().optional(),
  }).optional()).query(async ({ input, ctx }) => {
    const conditions = [eq(breakGlassGrants.tenantId, ctx.user.tenantId)];
    if (input?.userId) conditions.push(eq(breakGlassGrants.userId, input.userId));
    if (input?.licitacionId) conditions.push(eq(breakGlassGrants.licitacionId, input.licitacionId));
    return getDb().query.breakGlassGrants.findMany({ where: and(...conditions), orderBy: [desc(breakGlassGrants.createdAt)] });
  }),

  grantBreakGlass: capabilityQuery("break_glass").input(z.object({
    userId: z.number().int().positive(),
    licitacionId: z.number().int().positive().optional(),
    capability: z.string().trim().min(2).default("break_glass"),
    justificacion: z.string().trim().min(20),
    validUntil: z.string().datetime(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const until = new Date(input.validUntil);
    if (!(until.getTime() > Date.now())) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "validUntil debe ser futuro (grant temporal)." });
    }
    if (until.getTime() - Date.now() > 7 * 24 * 60 * 60 * 1000) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "break_glass máximo 7 días." });
    }
    const db = getDb();
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, input.userId), eq(users.tenantId, ctx.user.tenantId)),
    });
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado." });
    const expediente = input.licitacionId
      ? await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId)
      : null;
    let id = 0;
    await db.transaction(async (tx) => {
      const result = await tx.insert(breakGlassGrants).values({
        tenantId: ctx.user.tenantId,
        userId: input.userId,
        licitacionId: input.licitacionId ?? null,
        capability: input.capability,
        justificacion: input.justificacion,
        grantedBy: ctx.user.id,
        validFrom: new Date(),
        validUntil: until,
      } as any);
      id = Number(result[0].insertId);
      if (expediente) {
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: expediente.id,
          tipo: "BREAK_GLASS_GRANT",
          estadoAnterior: null,
          estadoNuevo: "ACTIVO",
          motivo: `${input.motivo} | ${input.justificacion}`,
          payload: { grantId: id, userId: input.userId, capability: input.capability, validUntil: until.toISOString() },
        });
      }
      await writeAudit({
        ctx: ctxForAudit(ctx), accion: "BREAK_GLASS_GRANT", entidad: "break_glass_grants", entidadId: id,
        valorNuevo: { userId: input.userId, capability: input.capability, licitacionId: input.licitacionId ?? null },
        motivo: input.motivo, tx,
      });
    });
    return db.query.breakGlassGrants.findFirst({
      where: and(eq(breakGlassGrants.id, id), eq(breakGlassGrants.tenantId, ctx.user.tenantId)),
    });
  }),

  revokeBreakGlass: adminQuery.input(z.object({
    id: z.number().int().positive(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await db.query.breakGlassGrants.findFirst({
      where: and(eq(breakGlassGrants.id, input.id), eq(breakGlassGrants.tenantId, ctx.user.tenantId)),
    });
    if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Grant no encontrado." });
    if (cur.revokedAt) throw new TRPCError({ code: "CONFLICT", message: "Grant ya revocado." });
    const expediente = cur.licitacionId
      ? await findExpedienteByLicitacion(ctx.user.tenantId, cur.licitacionId)
      : null;
    await db.transaction(async (tx) => {
      await tx.update(breakGlassGrants).set({
        revokedAt: new Date(), revokedBy: ctx.user.id,
      } as any).where(and(eq(breakGlassGrants.id, input.id), eq(breakGlassGrants.tenantId, ctx.user.tenantId)));
      if (expediente) {
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: expediente.id, tipo: "BREAK_GLASS_REVOKE",
          estadoAnterior: "ACTIVO", estadoNuevo: "REVOCADO", motivo: input.motivo,
          payload: { grantId: cur.id, userId: cur.userId, capability: cur.capability },
        });
      }
      await writeAudit({
        ctx: ctxForAudit(ctx), accion: "BREAK_GLASS_REVOKE", entidad: "break_glass_grants",
        entidadId: input.id, valorAnterior: cur, motivo: input.motivo, tx,
      });
    });
    return { success: true };
  }),

});
