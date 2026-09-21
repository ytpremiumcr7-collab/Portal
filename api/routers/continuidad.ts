import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery, capabilityQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { documentos, expedientes } from "@db/schema";
import { backupRestoreDrills, evidenceAnchors, legalHolds, legalHoldTargets } from "@db/schema-institutional";
import { verifyExpedienteEvidenceChain } from "../lib/expediente";
import { verifyDocumentStoreIntegrity } from "../lib/document-integrity";
import { writeAudit } from "../lib/security";

export const continuidadRouter = createRouter({
  runRestoreDrill: capabilityQuery("auditar").input(z.object({
    motivo: z.string().trim().min(8),
    expedienteId: z.number().int().positive().optional(),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const drillCode = `DRILL-${ctx.user.tenantId}-${Date.now()}`;
    const insert = await db.insert(backupRestoreDrills).values({
      tenantId: ctx.user.tenantId,
      drillCode,
      startedAt: new Date(),
      status: "RUNNING",
      actorUserId: ctx.user.id,
    });
    const drillId = Number(insert[0].insertId);
    const expRows = input.expedienteId
      ? await db.query.expedientes.findMany({ where: and(eq(expedientes.tenantId, ctx.user.tenantId), eq(expedientes.id, input.expedienteId)) })
      : await db.query.expedientes.findMany({ where: eq(expedientes.tenantId, ctx.user.tenantId) });
    let eventsChecked = 0;
    let eventBreaks = 0;
    const broken: number[] = [];
    for (const e of expRows) {
      const v = await verifyExpedienteEvidenceChain(ctx.user.tenantId, e.id);
      eventsChecked += v.events ?? 0;
      if (!v.valid) { eventBreaks += 1; broken.push(e.id); }
    }
    const docs = await verifyDocumentStoreIntegrity({ tenantId: ctx.user.tenantId, expedienteId: input.expedienteId });
    const mismatches = eventBreaks + docs.mismatched;
    const status = mismatches === 0 ? "PASSED" : "FAILED";
    await db.update(backupRestoreDrills).set({
      finishedAt: new Date(), status, eventsChecked,
      documentsChecked: docs.checked, mismatches,
      report: { brokenExpedientes: broken, documents: { ok: docs.ok, mismatched: docs.mismatched } },
    } as any).where(eq(backupRestoreDrills.id, drillId));
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "RESTORE_DRILL", entidad: "backup_restore_drills", entidadId: drillId, motivo: input.motivo });
    return { drillCode, status, eventsChecked, documentsChecked: docs.checked, mismatches, brokenExpedientes: broken };
  }),

  listDrills: adminQuery.query(async ({ ctx }) => {
    return getDb().query.backupRestoreDrills.findMany({
      where: eq(backupRestoreDrills.tenantId, ctx.user.tenantId),
      orderBy: [desc(backupRestoreDrills.startedAt)],
      limit: 50,
    });
  }),

  pendingAnchors: capabilityQuery("auditar").query(async ({ ctx }) => {
    return getDb().query.evidenceAnchors.findMany({
      where: and(eq(evidenceAnchors.tenantId, ctx.user.tenantId), eq(evidenceAnchors.status, "PENDING_EXTERNAL")),
      limit: 100,
    });
  }),
});

export const legalHoldRouter = createRouter({
  list: capabilityQuery("auditar").query(async ({ ctx }) => {
    return getDb().query.legalHolds.findMany({ where: eq(legalHolds.tenantId, ctx.user.tenantId) });
  }),
  create: adminQuery.input(z.object({
    holdCode: z.string().trim().min(3).max(100),
    reason: z.string().trim().min(10),
    authorityRef: z.string().trim().max(200).optional(),
    targets: z.array(z.object({ targetType: z.string().min(3), targetId: z.string().min(1) })).min(1),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    let holdId = 0;
    await db.transaction(async (tx) => {
      const r = await tx.insert(legalHolds).values({
        tenantId: ctx.user.tenantId, holdCode: input.holdCode, reason: input.reason,
        authorityRef: input.authorityRef ?? null, startsAt: new Date(), createdBy: ctx.user.id,
      });
      holdId = Number(r[0].insertId);
      for (const t of input.targets) {
        await tx.insert(legalHoldTargets).values({
          tenantId: ctx.user.tenantId, legalHoldId: holdId, targetType: t.targetType, targetId: t.targetId,
        });
        if (t.targetType === "documento") {
          await tx.execute(sql`UPDATE documentos SET legal_hold_active = 1 WHERE tenant_id = ${ctx.user.tenantId} AND id = ${Number(t.targetId)}`);
        }
      }
    });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "LEGAL_HOLD", entidad: "legal_holds", entidadId: holdId, motivo: input.motivo });
    return getDb().query.legalHolds.findFirst({ where: and(eq(legalHolds.id, holdId), eq(legalHolds.tenantId, ctx.user.tenantId)) });
  }),
  release: adminQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(8) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const hold = await db.query.legalHolds.findFirst({ where: and(eq(legalHolds.id, input.id), eq(legalHolds.tenantId, ctx.user.tenantId)) });
    if (!hold || hold.releasedAt) throw new TRPCError({ code: "CONFLICT", message: "Hold inexistente o ya liberado." });
    await db.update(legalHolds).set({ releasedAt: new Date(), releasedBy: ctx.user.id } as any)
      .where(and(eq(legalHolds.id, input.id), eq(legalHolds.tenantId, ctx.user.tenantId)));
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "LEGAL_HOLD_RELEASE", entidad: "legal_holds", entidadId: input.id, motivo: input.motivo });
    return { ok: true };
  }),
});
void documentos;
