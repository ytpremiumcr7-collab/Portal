import "dotenv/config";
import { getDb } from "../api/queries/connection";
import { tenants } from "./schema";
import { eq } from "drizzle-orm";
const rfc=process.env.SEED_TENANT_RFC?.trim().toUpperCase(); if(!rfc) throw new Error("SEED_TENANT_RFC es requerido para limpiar el tenant de seed.");
const result=await getDb().delete(tenants).where(eq(tenants.rfc,rfc)); console.log(`Seed clear: tenant ${rfc} eliminado.`,result);
