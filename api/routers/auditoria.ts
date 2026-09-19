import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { createRouter, adminQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { auditLog } from "@db/schema";
import { pageInput, pageResult } from "../lib/pagination";
import { verifyDocumentStoreIntegrity } from "../lib/document-integrity";

export const auditoriaRouter = createRouter({
  list: adminQuery.input(z.object({
    entidad: z.string().trim().optional(),
    entidadId: z.number().int().positive().optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(100).optional(),
  }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const c = [eq(auditLog.tenantId, ctx.user.tenantId)];
    if (input?.entidad) c.push(eq(auditLog.entidad, input.entidad));
    if (input?.entidadId) c.push(eq(auditLog.entidadId, input.entidadId));
    const where = and(...c);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.auditLog.findMany({ where, orderBy: [desc(auditLog.timestamp)], limit: pageSize, offset, with: { actor: true } }),
      db.select({ total: count() }).from(auditLog).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  verifyStoreIntegrity: adminQuery.input(z.object({
    documentoId: z.number().int().positive().optional(),
    expedienteId: z.number().int().positive().optional(),
    licitacionId: z.number().int().positive().optional(),
  }).optional()).query(async ({ input, ctx }) => verifyDocumentStoreIntegrity({
    tenantId: ctx.user.tenantId,
    documentoId: input?.documentoId,
    expedienteId: input?.expedienteId,
    licitacionId: input?.licitacionId,
  })),
});
