import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { createRouter, adminQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { tenantSmtpSettings, domainOutbox } from "@db/schema";
import { writeAudit } from "../lib/security";

export const smtpRouter = createRouter({
  getSettings: adminQuery.query(async ({ ctx }) => {
    const row = await getDb().query.tenantSmtpSettings.findFirst({
      where: eq(tenantSmtpSettings.tenantId, ctx.user.tenantId),
    });
    return row ?? {
      tenantId: ctx.user.tenantId, host: null, port: null, secure: false,
      username: null, fromAddress: null, fromName: null, status: "UNSET" as const,
      lastError: null, updatedBy: null, updatedAt: null,
    };
  }),

  upsertSettings: adminQuery.input(z.object({
    host: z.string().trim().min(1).max(255).nullable(),
    port: z.number().int().min(1).max(65535).nullable(),
    secure: z.boolean().default(false),
    username: z.string().trim().max(255).nullable().optional(),
    fromAddress: z.string().trim().email().nullable(),
    fromName: z.string().trim().max(180).nullable().optional(),
    status: z.enum(["UNSET", "CONFIGURED", "DISABLED", "ERROR"]).default("CONFIGURED"),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const existing = await db.query.tenantSmtpSettings.findFirst({ where: eq(tenantSmtpSettings.tenantId, ctx.user.tenantId) });
    const values = {
      tenantId: ctx.user.tenantId,
      host: input.host,
      port: input.port,
      secure: input.secure,
      username: input.username ?? null,
      fromAddress: input.fromAddress,
      fromName: input.fromName ?? null,
      status: input.host && input.fromAddress ? input.status : "UNSET",
      lastError: null,
      updatedBy: ctx.user.id,
    } as any;
    if (existing) {
      await db.update(tenantSmtpSettings).set(values).where(eq(tenantSmtpSettings.tenantId, ctx.user.tenantId));
    } else {
      await db.insert(tenantSmtpSettings).values(values);
    }
    const row = await db.query.tenantSmtpSettings.findFirst({ where: eq(tenantSmtpSettings.tenantId, ctx.user.tenantId) });
    await writeAudit({
      ctx: ctxForAudit(ctx), accion: "UPSERT_SMTP", entidad: "tenant_smtp_settings", entidadId: ctx.user.tenantId,
      valorAnterior: existing, valorNuevo: { ...row, /* never audit password — none stored here */ }, motivo: input.motivo,
    });
    return row;
  }),

  listOutbox: adminQuery.input(z.object({
    status: z.string().trim().optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(100).optional(),
  }).optional()).query(async ({ input, ctx }) => {
    const page = input?.page ?? 1;
    const pageSize = input?.pageSize ?? 20;
    const conditions = [eq(domainOutbox.tenantId, ctx.user.tenantId)];
    if (input?.status) conditions.push(eq(domainOutbox.status, input.status as any));
    const items = await getDb().query.domainOutbox.findMany({
      where: and(...conditions),
      orderBy: [desc(domainOutbox.id)],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { items, page, pageSize };
  }),
});
