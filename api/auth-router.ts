import { z } from "zod";
import { eq, and, count, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createRouter, authedQuery, adminQuery, publicQuery, ctxForAudit } from "./middleware";
import { getDb } from "./queries/connection";
import { tenants, users, proveedores } from "@db/schema";
import { findOrCreateLegalEntity, normalizeRfc, resolveProveedorLoginCandidates } from "./lib/supplier-legal-entity";
import { createSession, clearSessionCookie, hashPassword, verifyPassword, revokeSession, setSessionCookie, writeAudit } from "./lib/security";
import { pageInput, pageResult } from "./lib/pagination";
import { TRPCError } from "@trpc/server";
import { env } from "./lib/env";
import { assertLoginAllowed, recordLoginFailure, recordLoginSuccess } from "./lib/login-rate-limit";
import { resolveCapabilities } from "./lib/capabilities";
import { requestMeta } from "./lib/security";

const rfcMx = z.string().trim().toUpperCase().regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3}$/i, "RFC mexicano inválido.");
const strongPassword = z.string().min(12, "La contraseña debe tener al menos 12 caracteres.");

export const authRouter = createRouter({
  me: authedQuery.query(async ({ ctx }) => {
    const { passwordHash: _omit, ...safe } = ctx.user as typeof ctx.user & { passwordHash?: string | null };
    void _omit;
    const capabilities = [...(await resolveCapabilities(ctx.user))];
    return { ...safe, capabilities };
  }),

  register: publicQuery.input(z.object({
    tenantNombre: z.string().trim().min(3).max(180),
    tenantRfc: rfcMx,
    name: z.string().trim().min(2).max(255),
    email: z.string().email().transform(v => v.toLowerCase().trim()),
    password: strongPassword,
  })).mutation(async ({ input, ctx }) => {
    if (!env.allowPublicRegister) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "El registro público de organizaciones está deshabilitado. Use una invitación o contacte al administrador (ARES_ALLOW_PUBLIC_REGISTER).",
      });
    }
    const db = getDb();
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "El correo ya está registrado." });

    const tenantSlug = `${input.tenantRfc.toLowerCase()}-${randomUUID().slice(0, 8)}`;
    const passwordHash = await hashPassword(input.password);
    let createdUserId = 0;
    let createdTenantId = 0;
    await db.transaction(async (tx) => {
      const tenantResult = await tx.insert(tenants).values({ nombre: input.tenantNombre, slug: tenantSlug, rfc: input.tenantRfc });
      const tenantId = Number(tenantResult[0].insertId);
      createdTenantId = tenantId;
      const userResult = await tx.insert(users).values({
        tenantId,
        unionId: `local:${randomUUID()}`,
        name: input.name,
        email: input.email,
        passwordHash,
        role: "admin",
      });
      createdUserId = Number(userResult[0].insertId);

    });
    const user = await db.query.users.findFirst({ where: and(eq(users.id, createdUserId), eq(users.tenantId, createdTenantId)) });
    if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No fue posible crear el usuario." });
    const session = await createSession(user, ctx.req);
    setSessionCookie(ctx.resHeaders, session);
    return { success: true, role: user.role, tenantId: user.tenantId };
  }),

  login: publicQuery.input(z.object({ email: z.string().email().transform(v => v.toLowerCase().trim()), password: z.string().min(1) })).mutation(async ({ input, ctx }) => {
    const ip = requestMeta(ctx.req).ipAddress;
    await assertLoginAllowed(ip, input.email);
    const db = getDb();
    const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });
    if (!user || !user.passwordHash || !user.activo || !(await verifyPassword(input.password, user.passwordHash))) {
      await recordLoginFailure(ip, input.email).catch(() => undefined);
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Correo o contraseña incorrectos." });
    }
    await recordLoginSuccess(ip, input.email).catch(() => undefined);
    await db.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, user.id));
    const session = await createSession(user, ctx.req);
    setSessionCookie(ctx.resHeaders, session);
    return { success: true, role: user.role, tenantId: user.tenantId };
  }),

  /**
   * Licitante / proveedor login by national RFC + password.
   * Resolves supplier_legal_entities → tenant memberships.
   * Single membership → session; multiple → return list (caller must selectTenantMembership).
   */
  loginByRfc: publicQuery.input(z.object({
    rfc: rfcMx,
    password: z.string().min(1),
    tenantId: z.number().int().positive().optional(),
  })).mutation(async ({ input, ctx }) => {
    const ip = requestMeta(ctx.req).ipAddress;
    const rfc = normalizeRfc(input.rfc);
    await assertLoginAllowed(ip, `rfc:${rfc}`);
    const db = getDb();
    const { entity, memberships } = await resolveProveedorLoginCandidates(db, rfc);
    if (!entity || !memberships.length) {
      await recordLoginFailure(ip, `rfc:${rfc}`).catch(() => undefined);
      throw new TRPCError({ code: "UNAUTHORIZED", message: "RFC o contraseña incorrectos." });
    }

    const matched: typeof memberships = [];
    for (const m of memberships) {
      if (!m.passwordHash || !m.userActivo) continue;
      if (await verifyPassword(input.password, m.passwordHash)) matched.push(m);
    }
    if (!matched.length) {
      await recordLoginFailure(ip, `rfc:${rfc}`).catch(() => undefined);
      throw new TRPCError({ code: "UNAUTHORIZED", message: "RFC o contraseña incorrectos." });
    }
    await recordLoginSuccess(ip, `rfc:${rfc}`).catch(() => undefined);

    const publicMemberships = matched.map((m: (typeof memberships)[number]) => ({
      tenantId: m.tenantId,
      tenantNombre: m.tenantNombre,
      proveedorId: m.proveedorId,
      usuarioId: m.usuarioId,
      email: m.userEmail,
    }));

    if (input.tenantId) {
      const chosen = matched.find((m: (typeof memberships)[number]) => m.tenantId === input.tenantId);
      if (!chosen) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El tenant indicado no es membresía de este RFC." });
      }
      const user = await db.query.users.findFirst({ where: and(eq(users.id, chosen.usuarioId!), eq(users.tenantId, chosen.tenantId)) });
      if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Usuario de membresía no encontrado." });
      await db.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, user.id));
      const session = await createSession(user, ctx.req);
      setSessionCookie(ctx.resHeaders, session);
      return { success: true, role: user.role, tenantId: user.tenantId, requiresTenantSelection: false as const, memberships: publicMemberships, legalEntityId: entity.id, rfc: entity.rfc };
    }

    if (matched.length === 1) {
      const chosen = matched[0];
      const user = await db.query.users.findFirst({ where: and(eq(users.id, chosen.usuarioId!), eq(users.tenantId, chosen.tenantId)) });
      if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Usuario de membresía no encontrado." });
      await db.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, user.id));
      const session = await createSession(user, ctx.req);
      setSessionCookie(ctx.resHeaders, session);
      return { success: true, role: user.role, tenantId: user.tenantId, requiresTenantSelection: false as const, memberships: publicMemberships, legalEntityId: entity.id, rfc: entity.rfc };
    }

    return {
      success: false,
      requiresTenantSelection: true as const,
      memberships: publicMemberships,
      legalEntityId: entity.id,
      rfc: entity.rfc,
      message: "Seleccione el tenant (organización) para continuar.",
    };
  }),


  logout: authedQuery.mutation(async ({ ctx }) => {
    await revokeSession(ctx.req);
    clearSessionCookie(ctx.resHeaders);
    return { success: true };
  }),

  listUsers: adminQuery.input(z.object({page:z.number().int().positive().optional(),pageSize:z.number().int().positive().max(100).optional()}).optional()).query(async({input,ctx})=>{
    const {page,pageSize,offset}=pageInput(input?.page,input?.pageSize);
    const db=getDb(); const where=eq(users.tenantId,ctx.user.tenantId); const [items,totalRows]=await Promise.all([db.query.users.findMany({where,orderBy:[desc(users.createdAt)],limit:pageSize,offset,columns:{id:true,name:true,email:true,role:true,activo:true,createdAt:true,lastSignInAt:true}}),db.select({total:count()}).from(users).where(where)]);
    return pageResult(items,Number(totalRows[0]?.total??0),page,pageSize);
  }),

  createUser: adminQuery.input(z.object({
    name: z.string().trim().min(2).max(255),
    email: z.string().email().transform(v => v.toLowerCase().trim()),
    password: strongPassword,
    role: z.enum(["admin", "licitante", "proveedor"]),
    proveedor: z.object({
      razonSocial: z.string().trim().min(3).max(200),
      rfc: rfcMx,
      tipoProveedor: z.enum(["PERSONA_FISICA", "PERSONA_MORAL", "COOPERATIVA", "CONSORCIO"]),
      rubroPrincipal: z.string().trim().min(2).max(100),
    }).optional(),
  }).superRefine((value, issue) => {
    if (value.role === "proveedor" && !value.proveedor) issue.addIssue({ code: "custom", path: ["proveedor"], message: "El rol proveedor requiere expediente fiscal." });
    if (value.role !== "proveedor" && value.proveedor) issue.addIssue({ code: "custom", path: ["proveedor"], message: "Sólo el rol proveedor puede recibir un expediente proveedor." });
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const duplicate = await db.query.users.findFirst({ where: eq(users.email, input.email) });
    if (duplicate) throw new TRPCError({ code: "CONFLICT", message: "El correo ya está registrado." });
    const passwordHash = await hashPassword(input.password);
    let id = 0;
    await db.transaction(async (tx) => {
      const result = await tx.insert(users).values({
        tenantId: ctx.user.tenantId,
        unionId: `local:${randomUUID()}`,
        name: input.name,
        email: input.email,
        passwordHash,
        role: input.role,
      });
      id = Number(result[0].insertId);
      if (input.role === "proveedor" && input.proveedor) {
        const le = await findOrCreateLegalEntity(tx, {
          rfc: input.proveedor.rfc,
          razonSocial: input.proveedor.razonSocial,
          tipoPersona: input.proveedor.tipoProveedor,
        });
        await tx.insert(proveedores).values({
          tenantId: ctx.user.tenantId,
          usuarioId: id,
          legalEntityId: le.id,
          razonSocial: input.proveedor.razonSocial,
          rfc: normalizeRfc(input.proveedor.rfc),
          tipoProveedor: input.proveedor.tipoProveedor,
          rubroPrincipal: input.proveedor.rubroPrincipal,
          email: input.email,
          estadoVerificacion: "PENDIENTE",
          activo: true,
        });
      }
    });
    const created = await db.query.users.findFirst({ where: and(eq(users.id, id), eq(users.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "users", entidadId: id, valorNuevo: created });
    return created;
  }),
});
