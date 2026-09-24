import { z } from "zod";
import { and, count, desc, eq, inArray, like } from "drizzle-orm";
import { createRouter, adminQuery, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { proveedores, users, supplierLegalEntities } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { pageInput, pageResult } from "../lib/pagination";
import { writeAudit } from "../lib/security";
import { findOrCreateLegalEntity, normalizeRfc } from "../lib/supplier-legal-entity";
import { supplierAuthorities, supplierMemberships } from "@db/schema-eproc";
import { supplierProviderIdsForUser } from "../lib/supplier-authority";

const rfcMx = z.string().trim().toUpperCase().regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3}$/i, "RFC mexicano inválido.");

export const proveedoresRouter = createRouter({
  list: authedQuery.input(z.object({
    search: z.string().trim().optional(),
    tipo: z.enum(["PERSONA_FISICA", "PERSONA_MORAL", "COOPERATIVA", "CONSORCIO"]).optional(),
    rubro: z.string().trim().optional(),
    estado: z.enum(["PENDIENTE", "EN_REVISION", "VERIFICADO", "RECHAZADO", "SUSPENDIDO"]).optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(100).optional(),
  }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const c = [eq(proveedores.tenantId, ctx.user.tenantId)];
    if (ctx.user.role === "proveedor") {
      const ids = await supplierProviderIdsForUser(ctx.user.tenantId, ctx.user.id);
      if (!ids.length) return pageResult([], 0, page, pageSize);
      c.push(inArray(proveedores.id, ids));
    }
    if (input?.search) c.push(like(proveedores.razonSocial, `%${input.search}%`));
    if (input?.tipo) c.push(eq(proveedores.tipoProveedor, input.tipo));
    if (input?.rubro) c.push(like(proveedores.rubroPrincipal, `%${input.rubro}%`));
    if (input?.estado) c.push(eq(proveedores.estadoVerificacion, input.estado));
    const where = and(...c);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.proveedores.findMany({ where, orderBy: [desc(proveedores.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(proveedores).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getById: authedQuery.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const db = getDb();
    const item = await db.query.proveedores.findFirst({
      where: and(eq(proveedores.id, input.id), eq(proveedores.tenantId, ctx.user.tenantId)),
    });
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Proveedor no encontrado." });
    if (ctx.user.role === "proveedor") {
      const ids = await supplierProviderIdsForUser(ctx.user.tenantId, ctx.user.id);
      if (!ids.includes(item.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No representa a esta organización proveedora." });
      }
    }
    let legalEntity = null;
    if (item.legalEntityId) {
      legalEntity = await db.query.supplierLegalEntities.findFirst({
        where: eq(supplierLegalEntities.id, item.legalEntityId),
      });
    }
    return { ...item, legalEntity };
  }),

  create: adminQuery.input(z.object({
    razonSocial: z.string().trim().min(3).max(200),
    nombreFantasia: z.string().trim().optional(),
    rfc: rfcMx,
    usuarioId: z.number().int().positive().optional(),
    tipoProveedor: z.enum(["PERSONA_FISICA", "PERSONA_MORAL", "COOPERATIVA", "CONSORCIO"]),
    rubroPrincipal: z.string().trim().min(2).max(100),
    rubrosSecundarios: z.string().optional(),
    ciudad: z.string().trim().optional(),
    estado: z.string().trim().optional(),
    email: z.string().email(),
    telefono: z.string().optional(),
    sitioWeb: z.string().url().optional(),
    representanteLegal: z.string().trim().optional(),
    empleadosCantidad: z.number().int().nonnegative().optional(),
    facturacionAnual: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    certificaciones: z.string().optional(),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const rfc = normalizeRfc(input.rfc);
    const duplicate = await db.query.proveedores.findFirst({
      where: and(eq(proveedores.tenantId, ctx.user.tenantId), eq(proveedores.rfc, rfc)),
    });
    if (duplicate) throw new TRPCError({ code: "CONFLICT", message: "El RFC ya existe en este tenant." });
    if (input.usuarioId) {
      const u = await db.query.users.findFirst({
        where: and(eq(users.id, input.usuarioId), eq(users.tenantId, ctx.user.tenantId), eq(users.role, "proveedor")),
      });
      if (!u) throw new TRPCError({ code: "BAD_REQUEST", message: "El usuario asociado debe ser un proveedor del tenant." });
    }

    let id = 0;
    await db.transaction(async (tx) => {
      const le = await findOrCreateLegalEntity(tx, {
        rfc,
        razonSocial: input.razonSocial,
        tipoPersona: input.tipoProveedor,
      });
      const { rfc: _r, ...rest } = input;
      const result = await tx.insert(proveedores).values({
        tenantId: ctx.user.tenantId,
        ...rest,
        rfc,
        legalEntityId: le.id,
        estadoVerificacion: "PENDIENTE",
        activo: true,
      });
      id = Number(result[0].insertId);
      if (input.usuarioId) {
        await tx.insert(supplierMemberships).values({
          tenantId: ctx.user.tenantId,
          proveedorId: id,
          userId: input.usuarioId,
          role: "OWNER",
          active: true,
          createdBy: ctx.user.id,
        });
        await tx.insert(supplierAuthorities).values({
          tenantId: ctx.user.tenantId,
          proveedorId: id,
          userId: input.usuarioId,
          authorityType: "PROCUREMENT",
          authoritySource: "ADMIN_GRANTED",
          scope: { actions: ["SUBMIT", "WITHDRAW"] },
          active: true,
          createdBy: ctx.user.id,
        });
      }
    });

    const created = await db.query.proveedores.findFirst({
      where: and(eq(proveedores.id, id), eq(proveedores.tenantId, ctx.user.tenantId)),
    });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "proveedores", entidadId: id, valorNuevo: created });
    return created;
  }),

  myRepresentations: authedQuery.query(async ({ ctx }) => {
    const ids = await supplierProviderIdsForUser(ctx.user.tenantId, ctx.user.id);
    if (!ids.length) return [];
    return getDb().query.proveedores.findMany({
      where: and(
        eq(proveedores.tenantId, ctx.user.tenantId),
        inArray(proveedores.id, ids),
        eq(proveedores.activo, true),
      ),
      orderBy: [desc(proveedores.razonSocial)],
    });
  }),

  addMember: adminQuery.input(z.object({
    proveedorId: z.number().int().positive(),
    userId: z.number().int().positive(),
    role: z.enum(["OWNER","REPRESENTATIVE","PREPARER","SIGNER","ADMIN"]),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const [provider, user] = await Promise.all([
      db.query.proveedores.findFirst({
        where: and(eq(proveedores.tenantId, ctx.user.tenantId), eq(proveedores.id, input.proveedorId), eq(proveedores.activo, true)),
      }),
      db.query.users.findFirst({
        where: and(eq(users.tenantId, ctx.user.tenantId), eq(users.id, input.userId), eq(users.activo, true), eq(users.role, "proveedor")),
      }),
    ]);
    if (!provider || !user) throw new TRPCError({ code: "BAD_REQUEST", message: "Proveedor o usuario inválido." });
    let id = 0;
    await db.transaction(async (tx) => {
      const result = await tx.insert(supplierMemberships).values({
        tenantId: ctx.user.tenantId, proveedorId: input.proveedorId, userId: input.userId,
        role: input.role, active: true, createdBy: ctx.user.id,
      });
      id = Number(result[0].insertId);
      await writeAudit({
        ctx: ctxForAudit(ctx), accion: "ASIGNAR_MIEMBRO_PROVEEDOR",
        entidad: "supplier_memberships", entidadId: id, valorNuevo: input, motivo: input.motivo, tx,
      });
    });
    return { id };
  }),

  grantAuthority: adminQuery.input(z.object({
    proveedorId: z.number().int().positive(),
    userId: z.number().int().positive(),
    authorityType: z.enum(["LEGAL_REPRESENTATIVE","POWER_OF_ATTORNEY","SIGNATURE","PROCUREMENT"]),
    documentId: z.number().int().positive().optional(),
    procedureIds: z.array(z.number().int().positive()).optional(),
    lotIds: z.array(z.number().int().positive()).optional(),
    actions: z.array(z.enum(["SUBMIT","WITHDRAW"])).min(1),
    validUntil: z.string().datetime().optional(),
    motivo: z.string().trim().min(10),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const membership = await db.query.supplierMemberships.findFirst({
      where: and(
        eq(supplierMemberships.tenantId, ctx.user.tenantId),
        eq(supplierMemberships.proveedorId, input.proveedorId),
        eq(supplierMemberships.userId, input.userId),
        eq(supplierMemberships.active, true),
      ),
    });
    if (!membership) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El usuario debe tener membresía activa en la organización proveedora." });
    }
    if (["POWER_OF_ATTORNEY","SIGNATURE"].includes(input.authorityType) && !input.documentId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "El poder/firma requiere documento probatorio." });
    }
    let id = 0;
    await db.transaction(async (tx) => {
      const result = await tx.insert(supplierAuthorities).values({
        tenantId: ctx.user.tenantId,
        proveedorId: input.proveedorId,
        userId: input.userId,
        authorityType: input.authorityType,
        authoritySource: input.documentId ? "VERIFIED_DOCUMENT" : "ADMIN_GRANTED",
        scope: {
          procedureIds: input.procedureIds ?? null,
          lotIds: input.lotIds ?? null,
          actions: input.actions,
        },
        documentId: input.documentId ?? null,
        active: true,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        createdBy: ctx.user.id,
      });
      id = Number(result[0].insertId);
      await writeAudit({
        ctx: ctxForAudit(ctx), accion: "OTORGAR_AUTORIDAD_PROVEEDOR",
        entidad: "supplier_authorities", entidadId: id, valorNuevo: input, motivo: input.motivo, tx,
      });
    });
    return { id };
  }),

  update: adminQuery.input(z.object({
    id: z.number().int().positive(),
    razonSocial: z.string().trim().optional(),
    nombreFantasia: z.string().trim().nullable().optional(),
    rfc: rfcMx.optional(),
    usuarioId: z.number().int().positive().nullable().optional(),
    tipoProveedor: z.enum(["PERSONA_FISICA", "PERSONA_MORAL", "COOPERATIVA", "CONSORCIO"]).optional(),
    rubroPrincipal: z.string().trim().optional(),
    email: z.string().email().optional(),
    telefono: z.string().nullable().optional(),
    activo: z.boolean().optional(),
    estadoVerificacion: z.enum(["PENDIENTE", "EN_REVISION", "VERIFICADO", "RECHAZADO", "SUSPENDIDO"]).optional(),
    calificacionHistorica: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await db.query.proveedores.findFirst({
      where: and(eq(proveedores.id, input.id), eq(proveedores.tenantId, ctx.user.tenantId)),
    });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Proveedor no encontrado." });
    const { id, motivo, rfc, ...data } = input;

    await db.transaction(async (tx) => {
      const patch: Record<string, unknown> = { ...data };
      if (rfc) {
        const n = normalizeRfc(rfc);
        const le = await findOrCreateLegalEntity(tx, {
          rfc: n,
          razonSocial: (data.razonSocial as string) || current.razonSocial,
          tipoPersona: (data.tipoProveedor as any) || current.tipoProveedor,
        });
        patch.rfc = n;
        patch.legalEntityId = le.id;
      }
      await tx.update(proveedores).set(patch as any)
        .where(and(eq(proveedores.id, id), eq(proveedores.tenantId, ctx.user.tenantId)));
    });

    const updated = await db.query.proveedores.findFirst({
      where: and(eq(proveedores.id, id), eq(proveedores.tenantId, ctx.user.tenantId)),
    });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "ACTUALIZAR", entidad: "proveedores", entidadId: id, valorAnterior: current, valorNuevo: updated, motivo });
    return updated;
  }),

  delete: adminQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const current = await db.query.proveedores.findFirst({
      where: and(eq(proveedores.id, input.id), eq(proveedores.tenantId, ctx.user.tenantId)),
    });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Proveedor no encontrado." });
    if (current.activo === false) throw new TRPCError({ code: "CONFLICT", message: "El proveedor ya está desactivado." });
    await db.update(proveedores).set({ activo: false, estadoVerificacion: "SUSPENDIDO" })
      .where(and(eq(proveedores.id, input.id), eq(proveedores.tenantId, ctx.user.tenantId)));
    const updated = await db.query.proveedores.findFirst({
      where: and(eq(proveedores.id, input.id), eq(proveedores.tenantId, ctx.user.tenantId)),
    });
    await writeAudit({
      ctx: ctxForAudit(ctx), accion: "DESACTIVAR", entidad: "proveedores", entidadId: input.id,
      valorAnterior: current, valorNuevo: updated, motivo: input.motivo,
    });
    return { success: true, softDeleted: true };
  }),
});
