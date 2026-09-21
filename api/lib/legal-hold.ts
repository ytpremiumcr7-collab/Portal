import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { documentos } from "@db/schema";
import { legalHoldTargets, legalHolds } from "@db/schema-institutional";

export async function isTargetOnHold(tenantId: number, targetType: string, targetId: string | number): Promise<boolean> {
  const db = getDb();
  const rows = await db.query.legalHoldTargets.findMany({
    where: and(
      eq(legalHoldTargets.tenantId, tenantId),
      eq(legalHoldTargets.targetType, targetType),
      eq(legalHoldTargets.targetId, String(targetId)),
    ),
  });
  if (!rows.length) return false;
  for (const t of rows) {
    const hold = await db.query.legalHolds.findFirst({
      where: and(eq(legalHolds.id, t.legalHoldId), eq(legalHolds.tenantId, tenantId), isNull(legalHolds.releasedAt)),
    });
    if (hold) return true;
  }
  return false;
}

export async function assertNotOnHold(tenantId: number, targetType: string, targetId: string | number, action = "purgar") {
  if (await isTargetOnHold(tenantId, targetType, targetId)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Legal hold activo: no se puede ${action} ${targetType} #${targetId}.`,
    });
  }
}

export async function assertDocumentoPurgable(tenantId: number, documentoId: number) {
  const doc = await getDb().query.documentos.findFirst({
    where: and(eq(documentos.id, documentoId), eq(documentos.tenantId, tenantId)),
  });
  if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Documento no encontrado." });
  if ((doc as any).legalHoldActive) {
    throw new TRPCError({ code: "CONFLICT", message: "Documento bajo legal hold; la purga está bloqueada." });
  }
  await assertNotOnHold(tenantId, "documento", documentoId);
  if (doc.expedienteId) await assertNotOnHold(tenantId, "expediente", doc.expedienteId);
  return doc;
}

export function canExpireRetention(opts: { retentionUntil: Date | null; legalHoldActive: boolean; now?: Date }) {
  if (opts.legalHoldActive) return false;
  if (!opts.retentionUntil) return false;
  return (opts.now ?? new Date()).getTime() >= new Date(opts.retentionUntil).getTime();
}
