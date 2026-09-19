import "dotenv/config";
import { getDb } from "../api/queries/connection";
import { ensureSystemActorsForAllTenants } from "../api/lib/system-actor";

const r = await ensureSystemActorsForAllTenants(getDb());
console.log("[ensure-system-actors]", r);
