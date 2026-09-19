import { getDb } from "../queries/connection";
import { logAdapter, noopAdapter, smtpAdapter, processOutboxOnce, type DeliveryAdapter } from "./outbox";

export function resolveAdapter(name?: string): DeliveryAdapter {
  if (name === "noop") return noopAdapter;
  if (name === "smtp" || process.env.ARES_SMTP_URL) return smtpAdapter;
  return logAdapter;
}

export async function runOutboxOnce(opts: { limit?: number; adapter?: string } = {}) {
  const db = getDb();
  return processOutboxOnce(db, {
    limit: opts.limit ?? 50,
    adapter: resolveAdapter(opts.adapter),
  });
}

export async function main() {
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
