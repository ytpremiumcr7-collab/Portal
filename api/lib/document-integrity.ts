import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { documentos } from "@db/schema";
import { env } from "./env";

export async function verifyDocumentStoreIntegrity(opts: {
  tenantId: number;
  documentoId?: number;
  expedienteId?: number;
  licitacionId?: number;
}) {
  const db = getDb();
  const conditions = [eq(documentos.tenantId, opts.tenantId)];
  if (opts.documentoId) conditions.push(eq(documentos.id, opts.documentoId));
  if (opts.expedienteId) conditions.push(eq(documentos.expedienteId, opts.expedienteId));
  if (opts.licitacionId) conditions.push(eq(documentos.licitacionId, opts.licitacionId));
  const rows = await db.query.documentos.findMany({ where: and(...conditions) });
  const results: Array<{
    documentoId: number;
    storageKey: string;
    storedSha256: string;
    computedSha256: string | null;
    ok: boolean;
    error?: string;
  }> = [];
  for (const doc of rows) {
    try {
      const bytes = await readFile(path.resolve(env.storagePath, doc.storageKey));
      const computed = createHash("sha256").update(bytes).digest("hex");
      results.push({
        documentoId: doc.id,
        storageKey: doc.storageKey,
        storedSha256: doc.sha256,
        computedSha256: computed,
        ok: computed === doc.sha256,
      });
    } catch (e: any) {
      results.push({
        documentoId: doc.id,
        storageKey: doc.storageKey,
        storedSha256: doc.sha256,
        computedSha256: null,
        ok: false,
        error: e?.message ?? "read_failed",
      });
    }
  }
  const ok = results.every((r) => r.ok);
  return { ok, checked: results.length, mismatched: results.filter((r) => !r.ok).length, results };
}
