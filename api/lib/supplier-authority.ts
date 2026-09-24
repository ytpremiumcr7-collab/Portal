import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { proveedores } from "@db/schema";
import { supplierAuthorities, supplierMemberships } from "@db/schema-eproc";
import { getDb } from "../queries/connection";

export type SupplierAction = "SUBMIT" | "WITHDRAW";
export type SupplierRole = "OWNER" | "REPRESENTATIVE" | "PREPARER" | "SIGNER" | "ADMIN";
export type SupplierAuthorityType = "LEGAL_REPRESENTATIVE" | "POWER_OF_ATTORNEY" | "SIGNATURE" | "PROCUREMENT";

type Membership = {
  id:number; tenantId:number; proveedorId:number; userId:number; role:string; active:boolean;
  validFrom:Date; validUntil:Date|null;
};
type Authority = {
  id:number; tenantId:number; proveedorId:number; userId:number; authorityType:string;
  authoritySource:string; scope:unknown; documentId:number|null; active:boolean;
  validFrom:Date; validUntil:Date|null;
};

const ACTING_ROLES = new Set<SupplierRole>(["OWNER","REPRESENTATIVE","SIGNER","ADMIN"]);
const AUTHORITY_TYPES = new Set<SupplierAuthorityType>(["LEGAL_REPRESENTATIVE","POWER_OF_ATTORNEY","SIGNATURE","PROCUREMENT"]);

function activeAt(row:{active:boolean;validFrom:Date;validUntil:Date|null},now:Date){
  return row.active && row.validFrom<=now && (row.validUntil==null || row.validUntil>=now);
}
function scopeAllows(scope:unknown,procedureId:number,lotId:number,action:SupplierAction){
  if(!scope || typeof scope!=="object") return true;
  const s=scope as {procedureIds?:unknown;lotIds?:unknown;actions?:unknown};
  if(Array.isArray(s.procedureIds) && !s.procedureIds.map(Number).includes(procedureId)) return false;
  if(Array.isArray(s.lotIds) && !s.lotIds.map(Number).includes(lotId)) return false;
  if(Array.isArray(s.actions) && !s.actions.map(String).includes(action)) return false;
  return true;
}

export function evaluateSupplierActionAuthority(input:{
  tenantId:number;actorUserId:number;proveedorId:number;procedureId:number;lotId:number;
  action:SupplierAction;now?:Date;memberships:Membership[];authorities:Authority[];
}):{ok:boolean;membershipId?:number;authorityId?:number;representedProveedorId?:number;actorUserId?:number;reason?:string}{
  const now=input.now??new Date();
  const membership=input.memberships.find(m=>
    m.tenantId===input.tenantId && m.proveedorId===input.proveedorId && m.userId===input.actorUserId &&
    ACTING_ROLES.has(m.role as SupplierRole) && activeAt(m,now)
  );
  if(!membership) return {ok:false,reason:"No existe membresía vigente con facultad de representación para esta organización proveedora."};
  const authority=input.authorities.find(a=>
    a.tenantId===input.tenantId && a.proveedorId===input.proveedorId && a.userId===input.actorUserId &&
    AUTHORITY_TYPES.has(a.authorityType as SupplierAuthorityType) && activeAt(a,now) &&
    scopeAllows(a.scope,input.procedureId,input.lotId,input.action)
  );
  if(!authority) return {ok:false,reason:`No existe autoridad vigente y aplicable para ${input.action} en este procedimiento/lote.`};
  return {ok:true,membershipId:membership.id,authorityId:authority.id,representedProveedorId:input.proveedorId,actorUserId:input.actorUserId};
}

export async function supplierProviderIdsForUser(tenantId:number,userId:number){
  const now=new Date();
  const rows=await getDb().query.supplierMemberships.findMany({
    where:and(eq(supplierMemberships.tenantId,tenantId),eq(supplierMemberships.userId,userId),eq(supplierMemberships.active,true)),
  });
  return [...new Set(rows.filter(m=>activeAt(m,now)).map(m=>Number(m.proveedorId)))];
}

function resolvedSupplierActor(input:{
  tenantId:number;actorUserId:number;proveedorId:number;procedureId:number;lotId:number;action:SupplierAction;
}, provider:any, memberships:any[], authorities:any[]){
  const evaluated=evaluateSupplierActionAuthority({...input,memberships,authorities});
  if(!evaluated.ok||evaluated.membershipId==null||evaluated.authorityId==null){
    throw new TRPCError({code:"FORBIDDEN",message:evaluated.reason??"Autoridad de proveedor insuficiente."});
  }
  if(provider.legalEntityId==null){
    throw new TRPCError({code:"PRECONDITION_FAILED",message:"La organización proveedora no tiene identidad legal vinculada."});
  }
  const membership=memberships.find(m=>m.id===evaluated.membershipId)!;
  const authority=authorities.find(a=>a.id===evaluated.authorityId)!;
  const authoritySnapshot={
    schemaVersion:1,actorUserId:input.actorUserId,representedProveedorId:provider.id,
    supplierLegalEntityId:provider.legalEntityId,membershipId:membership.id,membershipRole:membership.role,
    authorityId:authority.id,authorityType:authority.authorityType,authoritySource:authority.authoritySource,
    authorityDocumentId:authority.documentId,scope:authority.scope,validFrom:authority.validFrom.toISOString(),
    validUntil:authority.validUntil?.toISOString()??null,action:input.action,procedureId:input.procedureId,lotId:input.lotId,
    capturedAt:new Date().toISOString(),
  };
  return {provider,membership,authority,authoritySnapshot};
}

export async function resolveSupplierActor(input:{
  tenantId:number;actorUserId:number;proveedorId:number;procedureId:number;lotId:number;action:SupplierAction;
}){
  const db=getDb();
  const provider=await db.query.proveedores.findFirst({
    where:and(eq(proveedores.tenantId,input.tenantId),eq(proveedores.id,input.proveedorId),eq(proveedores.activo,true)),
  });
  if(!provider) throw new TRPCError({code:"NOT_FOUND",message:"Organización proveedora no encontrada o inactiva."});
  const [memberships,authorities]=await Promise.all([
    db.query.supplierMemberships.findMany({where:and(eq(supplierMemberships.tenantId,input.tenantId),eq(supplierMemberships.proveedorId,input.proveedorId),eq(supplierMemberships.userId,input.actorUserId))}),
    db.query.supplierAuthorities.findMany({where:and(eq(supplierAuthorities.tenantId,input.tenantId),eq(supplierAuthorities.proveedorId,input.proveedorId),eq(supplierAuthorities.userId,input.actorUserId))}),
  ]);
  return resolvedSupplierActor(input,provider,memberships as any[],authorities as any[]);
}

export async function resolveSupplierActorInTx(tx:any,input:{
  tenantId:number;actorUserId:number;proveedorId:number;procedureId:number;lotId:number;action:SupplierAction;
}){
  const providerRows=await tx.select().from(proveedores)
    .where(and(eq(proveedores.tenantId,input.tenantId),eq(proveedores.id,input.proveedorId),eq(proveedores.activo,true)))
    .for("update").limit(1);
  const provider=providerRows[0];
  if(!provider) throw new TRPCError({code:"NOT_FOUND",message:"Organización proveedora no encontrada o inactiva."});
  const memberships=await tx.select().from(supplierMemberships)
    .where(and(eq(supplierMemberships.tenantId,input.tenantId),eq(supplierMemberships.proveedorId,input.proveedorId),eq(supplierMemberships.userId,input.actorUserId)))
    .for("update");
  const authorities=await tx.select().from(supplierAuthorities)
    .where(and(eq(supplierAuthorities.tenantId,input.tenantId),eq(supplierAuthorities.proveedorId,input.proveedorId),eq(supplierAuthorities.userId,input.actorUserId)))
    .for("update");
  return resolvedSupplierActor(input,provider,memberships as any[],authorities as any[]);
}
