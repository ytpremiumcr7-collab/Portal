import { getDb } from "../queries/connection";
import { logAdapter, noopAdapter, smtpAdapter, processOutboxOnce, reclaimStaleOutboxClaims, type DeliveryAdapter } from "./outbox";

export function resolveAdapter(name?: string): DeliveryAdapter {
  if (name === "noop") return noopAdapter;
  if (name === "smtp" || process.env.ARES_SMTP_URL || process.env.SMTP_HOST) return smtpAdapter;
  return logAdapter;
}

export async function runOutboxOnce(opts: { limit?: number; adapter?: string } = {}) {
  const db = getDb();
  return processOutboxOnce(db, {
    limit: opts.limit ?? 50,
    adapter: resolveAdapter(opts.adapter),
  });
}

export async function runOutboxLoop(opts: {
  limit?: number;
  adapter?: string;
  intervalMs?: number;
  leaseMinutes?: number;
} = {}) {
  const db = getDb();
  const intervalMs = opts.intervalMs ?? Number(process.env.OUTBOX_POLL_MS ?? 10_000);
  const leaseMinutes = opts.leaseMinutes ?? Number(process.env.OUTBOX_LEASE_MINUTES ?? 15);
  console.info("[outbox:worker] loop start", { intervalMs, leaseMinutes, adapter: opts.adapter ?? process.env.OUTBOX_ADAPTER ?? "log" });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const reclaimed = await reclaimStaleOutboxClaims(db, leaseMinutes);
      const result = await processOutboxOnce(db, {
        limit: opts.limit ?? Number(process.env.OUTBOX_LIMIT ?? 50),
        adapter: resolveAdapter(opts.adapter ?? process.env.OUTBOX_ADAPTER),
        leaseMinutes,
      });
      console.info("[outbox:worker] tick", { ...result, reclaimed });
    } catch (e: any) {
      console.error("[outbox:worker] tick error", e?.message ?? e);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function main() {
  const loop = process.argv.includes("--loop") || process.env.OUTBOX_LOOP === "1";
  if (loop) {
    await runOutboxLoop({
      limit: Number(process.env.OUTBOX_LIMIT ?? 50),
      adapter: process.env.OUTBOX_ADAPTER ?? "log",
    });
    return;
  }
  const result = await runOutboxOnce({
    limit: Number(process.env.OUTBOX_LIMIT ?? 50),
    adapter: process.env.OUTBOX_ADAPTER ?? "log",
  });
  console.log(JSON.stringify({ ok: true, ...result }));
}

const isDirect = process.argv[1]?.includes("outbox-worker");
if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
