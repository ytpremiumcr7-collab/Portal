/**
 * Ops one-shot: migrate legacy plaintext montoOferta into sobres_economicos
 * and ensure system actors for all tenants.
 *
 * Prefer encrypt+placeholder when ARES_ENVELOPE_KEY is set.
 * If key missing: reports flaggedLegacy ids (convocante reads blocked until key+migrate).
 *
 * Usage: npx tsx scripts/migrate-legacy-sobres.ts [--dry-run]
 */
import "dotenv/config";
import { getDb } from "../api/queries/connection";
import { migrateLegacyPlaintextMontos, hasEnvelopeKeyConfigured } from "../api/lib/sobre-economico";
import { ensureSystemActorsForAllTenants } from "../api/lib/system-actor";

const dryRun = process.argv.includes("--dry-run");
const db = getDb();

const actors = await ensureSystemActorsForAllTenants(db);
console.log("[migrate] system actors", actors);

if (!hasEnvelopeKeyConfigured()) {
  console.warn(
    "[migrate] ARES_ENVELOPE_KEY not set — legacy plaintext rows will be FLAGGED only (not encrypted). " +
      "Convocante reads of those montos remain blocked until key is set and this script re-run.",
  );
}

const result = await migrateLegacyPlaintextMontos(db, { dryRun });
console.log("[migrate] legacy sobres", { dryRun, ...result });
process.exit(0);
