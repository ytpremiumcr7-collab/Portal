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
  PROCEDIMIENTO_ROLES, SENSITIVE_PROCEDIMIENTO_ROLES, isProcedimientoRole, assertNoRoleConflict, DEFAULT_ROLE_INCOMPATIBILIDADES,
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
    approvedBy: z.number().int().positive().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    if (!isProcedimientoRole(input.rol)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Rol de procedimiento desconocido: ${input.rol}` });
    }
    // Second-person: self-assign of sensitive roles forbidden unless approvedBy != requester
    const approvedBy = (input as any).approvedBy as number | undefined;
    if (input.userId === ctx.user.id && (SENSITIVE_PROCEDIMIENTO_ROLES as readonly string[]).includes(input.rol)) {
      if (!approvedBy || approvedBy === ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No puede auto-asignarse un rol sensible de procedimiento; se requiere segundo aprobador (approvedBy).",
        });
      }
    }
    if (input.overrideSod) {
      if (!approvedBy || approvedBy === ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Override de SoD requiere segundo aprobador (approvedBy ≠ solicitante).",
        });
      }
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
        justificacionOverride: input.overrideSod ? (input.justificacionOverride ?? null) : null,
        asignadoPor: ctx.user.id,
        approvedBy: input.approvedBy ?? null,
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

  /**
   * Two-step break-glass (preferred): requestBreakGlass → approveBreakGlass by OTHER admin.
   * Single-call grantBreakGlass only when approvedBy is passed and ≠ requester and ≠ beneficiary.
   * FORBIDDEN: userId === ctx.user.id (self grant).
   */
  requestBreakGlass: capabilityQuery("break_glass").input(z.object({
    userId: z.number().int().positive(),
    licitacionId: z.number().int().positive().optional(),
    capability: z.string().trim().min(2).default("break_glass"),
    justificacion: z.string().trim().min(20),
    validUntil: z.string().datetime(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    if (input.userId === ctx.user.id) {
      throw new TRPCError({ code: "FORBIDDEN", message: "No puede solicitar break_glass para sí mismo." });
    }
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
    const result = await db.insert(breakGlassGrants).values({
      tenantId: ctx.user.tenantId,
      userId: input.userId,
      licitacionId: input.licitacionId ?? null,
      capability: input.capability,
      justificacion: input.justificacion,
      status: "REQUESTED",
      grantedBy: ctx.user.id,
      requestedBy: ctx.user.id,
      approvedBy: null,
      approvedAt: null,
      validFrom: new Date(),
      validUntil: until,
    } as any);
    const id = Number(result[0].insertId);
    await writeAudit({
      ctx: ctxForAudit(ctx), accion: "BREAK_GLASS_REQUEST", entidad: "break_glass_grants", entidadId: id,
      valorNuevo: { userId: input.userId, capability: input.capability, status: "REQUESTED" },
      motivo: input.motivo,
    });
    return db.query.breakGlassGrants.findFirst({
      where: and(eq(breakGlassGrants.id, id), eq(breakGlassGrants.tenantId, ctx.user.tenantId)),
    });
  }),

  approveBreakGlass: capabilityQuery("break_glass").input(z.object({
    id: z.number().int().positive(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await db.query.breakGlassGrants.findFirst({
      where: and(eq(breakGlassGrants.id, input.id), eq(breakGlassGrants.tenantId, ctx.user.tenantId)),
    });
    if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Grant no encontrado." });
    if (cur.status !== "REQUESTED") throw new TRPCError({ code: "CONFLICT", message: "Sólo se aprueban grants REQUESTED." });
    const requester = cur.requestedBy ?? cur.grantedBy;
    if (ctx.user.id === Number(requester) || ctx.user.id === Number(cur.userId)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "El aprobador de break_glass debe ser distinto del solicitante y del beneficiario.",
      });
    }
    const expediente = cur.licitacionId
      ? await findExpedienteByLicitacion(ctx.user.tenantId, cur.licitacionId)
      : null;
    await db.transaction(async (tx) => {
      await tx.update(breakGlassGrants).set({
        status: "APPROVED",
        approvedBy: ctx.user.id,
        approvedAt: new Date(),
      } as any).where(and(eq(breakGlassGrants.id, input.id), eq(breakGlassGrants.tenantId, ctx.user.tenantId)));
      if (expediente) {
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: expediente.id,
          tipo: "BREAK_GLASS_GRANT",
          estadoAnterior: "REQUESTED",
          estadoNuevo: "APPROVED",
          motivo: input.motivo,
          payload: { grantId: cur.id, userId: cur.userId, capability: cur.capability, approvedBy: ctx.user.id },
        });
      }
      await writeAudit({
        ctx: ctxForAudit(ctx), accion: "BREAK_GLASS_APPROVE", entidad: "break_glass_grants", entidadId: input.id,
        valorAnterior: cur, motivo: input.motivo, tx,
      });
    });
    return db.query.breakGlassGrants.findFirst({
      where: and(eq(breakGlassGrants.id, input.id), eq(breakGlassGrants.tenantId, ctx.user.tenantId)),
    });
  }),

  grantBreakGlass: capabilityQuery("break_glass").input(z.object({
    userId: z.number().int().positive(),
    licitacionId: z.number().int().positive().optional(),
    capability: z.string().trim().min(2).default("break_glass"),
    justificacion: z.string().trim().min(20),
    validUntil: z.string().datetime(),
    /** Required for single-call path; must differ from requester and beneficiary. */
    approvedBy: z.number().int().positive().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    if (input.userId === ctx.user.id) {
      throw new TRPCError({ code: "FORBIDDEN", message: "No puede otorgarse break_glass a sí mismo." });
    }
    // Prefer REQUESTED→APPROVED; single-call only if approvedBy passed and distinct.
    if (!input.approvedBy || input.approvedBy === ctx.user.id || input.approvedBy === input.userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "grantBreakGlass de un solo paso requiere approvedBy distinto del solicitante y del beneficiario. Prefiera requestBreakGlass → approveBreakGlass.",
      });
    }
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
    const approver = await db.query.users.findFirst({
      where: and(eq(users.id, input.approvedBy), eq(users.tenantId, ctx.user.tenantId)),
    });
    if (!approver) throw new TRPCError({ code: "NOT_FOUND", message: "Aprobador no encontrado." });
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
        status: "APPROVED",
        grantedBy: ctx.user.id,
        requestedBy: ctx.user.id,
        approvedBy: input.approvedBy,
        approvedAt: new Date(),
        validFrom: new Date(),
        validUntil: until,
      } as any);
      id = Number(result[0].insertId);
      if (expediente) {
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: expediente.id,
          tipo: "BREAK_GLASS_GRANT",
          estadoAnterior: null,
          estadoNuevo: "APPROVED",
          motivo: `${input.motivo} | ${input.justificacion}`,
          payload: { grantId: id, userId: input.userId, capability: input.capability, approvedBy: input.approvedBy, validUntil: until.toISOString() },
        });
      }
      await writeAudit({
        ctx: ctxForAudit(ctx), accion: "BREAK_GLASS_GRANT", entidad: "break_glass_grants", entidadId: id,
        valorNuevo: { userId: input.userId, capability: input.capability, licitacionId: input.licitacionId ?? null, approvedBy: input.approvedBy },
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
        revokedAt: new Date(), revokedBy: ctx.user.id, status: "REVOKED",
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


  /**
   * One-shot admin bootstrap for a new procedimiento: assigns `creador` only
   * to the first user (default: licitacion.convocanteId / caller).
   * Does NOT grant all roles — operational caps still need procedimiento_asignaciones
   * (evaluador_*, autorizador_fallo, …) and/or explicit user_capabilities.
   * Fails if any asignación already exists for the procedimiento.
   */
  bootstrapAsignaciones: adminQuery.input(z.object({
    licitacionId: z.number().int().positive(),
    userId: z.number().int().positive().optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const lic = await db.query.licitaciones.findFirst({
      where: and(eq(licitaciones.id, input.licitacionId), eq(licitaciones.tenantId, ctx.user.tenantId)),
    });
    if (!lic) throw new TRPCError({ code: "NOT_FOUND", message: "Licitación no encontrada." });
    const existing = await db.query.procedimientoAsignaciones.findMany({
      where: and(
        eq(procedimientoAsignaciones.tenantId, ctx.user.tenantId),
        eq(procedimientoAsignaciones.licitacionId, input.licitacionId),
      ),
    });
    if (existing.length > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "bootstrapAsignaciones es one-shot: el procedimiento ya tiene asignaciones. Use sod.asignar.",
      });
    }
    const targetUserId = input.userId ?? Number(lic.convocanteId) ?? ctx.user.id;
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, targetUserId), eq(users.tenantId, ctx.user.tenantId)),
    });
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado." });
    if (user.role === "proveedor") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "bootstrapAsignaciones no asigna roles de procedimiento a proveedores." });
    }
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    let id = 0;
    await db.transaction(async (tx) => {
      const result = await tx.insert(procedimientoAsignaciones).values({
        tenantId: ctx.user.tenantId,
        licitacionId: input.licitacionId,
        userId: targetUserId,
        rol: "creador",
        overrideSod: false,
        justificacionOverride: null,
        asignadoPor: ctx.user.id,
      });
      id = Number(result[0].insertId);
      if (expediente) {
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: expediente.id,
          tipo: "SOD_BOOTSTRAP_ASIGNACION",
          estadoAnterior: null,
          estadoNuevo: "creador",
          motivo: input.motivo,
          payload: { asignacionId: id, userId: targetUserId, rol: "creador", oneShot: true },
        });
      }
    });
    const created = await db.query.procedimientoAsignaciones.findFirst({
      where: and(eq(procedimientoAsignaciones.id, id), eq(procedimientoAsignaciones.tenantId, ctx.user.tenantId)),
    });
    await writeAudit({
      ctx: ctxForAudit(ctx), accion: "SOD_BOOTSTRAP",
      entidad: "procedimiento_asignaciones", entidadId: id, valorNuevo: created, motivo: input.motivo,
    });
    return {
      asignacion: created,
      note: "Sólo rol «creador». Asigne evaluador_*/autorizador_fallo/… vía sod.asignar; no se restauran caps globales de licitante.",
    };
  }),

});
