import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { publicationHeads, publicationReleases } from "@db/schema-eproc";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export async function recordPublicationRelease(tx: any, input: {
  tenantId: number;
  licitacionId: number;
  eventType: string;
  sourceType: string;
  sourceId: number;
  payload: unknown;
  publishedBy: number;
  supersedesReleaseId?: number | null;
  correctionReason?: string | null;
}) {
  await tx.execute(sql`
    INSERT INTO publication_heads (tenant_id, licitacion_id, last_release_no)
    VALUES (${input.tenantId}, ${input.licitacionId}, 0)
    ON DUPLICATE KEY UPDATE id = id
  `);
  const rows = await tx.select().from(publicationHeads)
    .where(and(eq(publicationHeads.tenantId, input.tenantId), eq(publicationHeads.licitacionId, input.licitacionId)))
    .for("update").limit(1);
  const head = rows[0];
  if (!head) throw new Error("publication head unavailable");
  const releaseNo = Number(head.lastReleaseNo) + 1;
  const payload = canonical(input.payload);
  const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const releaseTag = `${input.licitacionId}-${String(releaseNo).padStart(6, "0")}-${input.eventType}`;
  const inserted = await tx.insert(publicationReleases).values({
    tenantId: input.tenantId, licitacionId: input.licitacionId, releaseNo, releaseTag,
    eventType: input.eventType, sourceType: input.sourceType, sourceId: input.sourceId,
    payloadHash, payload, publishedBy: input.publishedBy,
    supersedesReleaseId: input.supersedesReleaseId ?? null,
    correctionReason: input.correctionReason ?? null,
  } as any);
  await tx.update(publicationHeads).set({ lastReleaseNo: releaseNo })
    .where(and(eq(publicationHeads.tenantId, input.tenantId), eq(publicationHeads.licitacionId, input.licitacionId)));
  return { id: Number(inserted[0].insertId), releaseNo, releaseTag, payloadHash };
}
