import "dotenv/config";
import { getDb } from "../api/queries/connection";
import { tenants, users } from "./schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../api/lib/security";
import { ensureSystemActor } from "../api/lib/system-actor";

const envRequired=(name:string)=>{const v=process.env[name]?.trim();if(!v)throw new Error(`${name} es requerido para ejecutar el seed.`);return v;};
const email=envRequired("SEED_ADMIN_EMAIL").toLowerCase(); const password=envRequired("SEED_ADMIN_PASSWORD"); const tenantName=envRequired("SEED_TENANT_NAME"); const tenantRfc=envRequired("SEED_TENANT_RFC").toUpperCase();
const db=getDb();
const existing=await db.query.users.findFirst({where:eq(users.email,email)});
if(existing){
  await ensureSystemActor(db, existing.tenantId);
  console.log("Seed: usuario administrador ya existe; system actor asegurado.");
  process.exit(0);
}
const slug=`${tenantRfc.toLowerCase()}-${randomUUID().slice(0,8)}`;
const passwordHash=await hashPassword(password);
let tenantId=0;
await db.transaction(async tx=>{
 const tenant=await tx.insert(tenants).values({nombre:tenantName,slug,rfc:tenantRfc});
 tenantId=Number(tenant[0].insertId);
 await tx.insert(users).values({tenantId,unionId:`local:${randomUUID()}`,name:"Administrador inicial",email,passwordHash,role:"admin"});
 await ensureSystemActor(tx, tenantId);
});
console.log("Seed: organización, administrador y system actor creados.");
