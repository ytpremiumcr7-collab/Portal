import { drizzle } from "drizzle-orm/mysql2";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as institutional from "@db/schema-institutional";
import * as eproc from "@db/schema-eproc";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...institutional, ...eproc, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;

export function getDb() {
  if (!instance) {
    instance = drizzle(env.databaseUrl, {
      mode: "planetscale",
      schema: fullSchema,
    });
  }
  return instance;
}
