import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminQuery, authedQuery, convocanteQuery, createRouter, ctxForAudit } from "../middleware";
import { entidades, users } from "@db/schema";
import { authorityDelegations, organizationalUnits, organizationalUnitMemberships } from "@db/schema-eproc";
import { getDb } from "../queries/connection";
import { assertDirectUnitMembership } from "../lib/institutional-authority";
import { writeAudit } from "../lib/security";

const institutionalRole = z.enum(["OPERADOR","TECNICO","JURIDICO","PRESUPUESTO","APROBADOR","ADMIN_CONTRATO","AUDITOR"]);

export const institutionalRouter = createRouter({
  units: convocanteQuery.input(z.object({ entidadId: z.number().int().positive().optional() }).optional()).query(async ({ input, ctx }) => {
    const conditions = [eq(organizationalUnits.tenantId, ctx.user.tenantId), eq(organizationalUnits.active, true)];
    if (input?.entidadId) conditions.push(eq(organizationalUnits.entidadId, input.entidadId));
    return getDb().query.organizationalUnits.findMany({ where: and(...conditions), orderBy: [asc(organizationalUnits.name)] });
  }),

  createUnit: adminQuery.input(z.object({
    entidadId: z.number().int().positive(),
    code: z.string().trim().min(2).max(80),
    name: z.string().trim().min(3).max(200),
    unitType: z.enum(["UNIDAD_COMPRADORA","AREA_REQUIRENTE","JURIDICO","PRESUPUESTO","CONTRATO","AUDITORIA"]),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const entity = await db.query.entidades.findFirst({ where: and(eq(entidades.tenantId, ctx.user.tenantId), eq(entidades.id, input.entidadId), eq(entidades.activa, true)) });
    if (!entity) throw new TRPCError({ code: "BAD_REQUEST", message: "Entidad inexistente o inactiva." });
    let id=0;
    await db.transaction(async (tx) => {
      const result = await tx.insert(organizationalUnits).values({
        tenantId: ctx.user.tenantId, entidadId: input.entidadId, code: input.code.toUpperCase(),
        name: input.name, unitType: input.unitType, active: true, createdBy: ctx.user.id,
      });
      id=Number(result[0].insertId);
      await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR_UNIDAD", entidad: "organizational_units", entidadId: id, valorNuevo: input, motivo: input.motivo, tx });
    });
    return db.query.organizationalUnits.findFirst({ where: and(eq(organizationalUnits.tenantId, ctx.user.tenantId), eq(organizationalUnits.id, id)) });
  }),

  memberships: adminQuery.input(z.object({ unitId: z.number().int().positive().optional() }).optional()).query(async ({ input, ctx }) => {
    const conditions=[eq(organizationalUnitMemberships.tenantId,ctx.user.tenantId)];
    if(input?.unitId) conditions.push(eq(organizationalUnitMemberships.unitId,input.unitId));
    return getDb().query.organizationalUnitMemberships.findMany({where:and(...conditions),orderBy:[asc(organizationalUnitMemberships.userId)]});
  }),

  addMembership: adminQuery.input(z.object({
    unitId:z.number().int().positive(), userId:z.number().int().positive(), role:institutionalRole,
    validFrom:z.string().datetime().optional(), validUntil:z.string().datetime().optional(), motivo:z.string().trim().min(3),
  })).mutation(async({input,ctx})=>{
    const db=getDb();
    const [unit,user]=await Promise.all([
      db.query.organizationalUnits.findFirst({where:and(eq(organizationalUnits.tenantId,ctx.user.tenantId),eq(organizationalUnits.id,input.unitId),eq(organizationalUnits.active,true))}),
      db.query.users.findFirst({where:and(eq(users.tenantId,ctx.user.tenantId),eq(users.id,input.userId),eq(users.activo,true))}),
    ]);
    if(!unit||!user) throw new TRPCError({code:"BAD_REQUEST",message:"Unidad o usuario inválido."});
    const from=input.validFrom?new Date(input.validFrom):new Date();
    const until=input.validUntil?new Date(input.validUntil):null;
    if(until && until<=from) throw new TRPCError({code:"BAD_REQUEST",message:"Vigencia de membresía inválida."});
    let id=0;
    await db.transaction(async tx=>{
      const result=await tx.insert(organizationalUnitMemberships).values({
        tenantId:ctx.user.tenantId,unitId:input.unitId,userId:input.userId,role:input.role,
        active:true,validFrom:from,validUntil:until,createdBy:ctx.user.id,
      });
      id=Number(result[0].insertId);
      await writeAudit({ctx:ctxForAudit(ctx),accion:"ASIGNAR_MEMBRESIA",entidad:"organizational_unit_memberships",entidadId:id,valorNuevo:{...input,validFrom:from,validUntil:until},motivo:input.motivo,tx});
    });
    return db.query.organizationalUnitMemberships.findFirst({where:and(eq(organizationalUnitMemberships.tenantId,ctx.user.tenantId),eq(organizationalUnitMemberships.id,id))});
  }),

  delegate: authedQuery.input(z.object({
    unitId:z.number().int().positive(), delegateeUserId:z.number().int().positive(), role:institutionalRole,
    procedureIds:z.array(z.number().int().positive()).optional(), actions:z.array(z.string().trim().min(1)).optional(),
    validFrom:z.string().datetime(),validUntil:z.string().datetime(),reason:z.string().trim().min(10),
  })).mutation(async({input,ctx})=>{
    const source=await assertDirectUnitMembership(ctx.user,input.unitId,input.role);
    const from=new Date(input.validFrom), until=new Date(input.validUntil);
    if(until<=from) throw new TRPCError({code:"BAD_REQUEST",message:"Vigencia de delegación inválida."});
    const db=getDb();
    const delegatee=await db.query.users.findFirst({where:and(eq(users.tenantId,ctx.user.tenantId),eq(users.id,input.delegateeUserId),eq(users.activo,true))});
    if(!delegatee) throw new TRPCError({code:"BAD_REQUEST",message:"Usuario delegado inválido."});
    if(delegatee.id===ctx.user.id) throw new TRPCError({code:"BAD_REQUEST",message:"No puede delegarse autoridad a sí mismo."});
    let id=0;
    await db.transaction(async tx=>{
      const result=await tx.insert(authorityDelegations).values({
        tenantId:ctx.user.tenantId,unitId:input.unitId,delegatorUserId:ctx.user.id,delegateeUserId:input.delegateeUserId,
        role:input.role,sourceAuthoritySnapshot:source,scope:{procedureIds:input.procedureIds??null,actions:input.actions??null},
        reason:input.reason,active:true,validFrom:from,validUntil:until,
      });
      id=Number(result[0].insertId);
      await writeAudit({ctx:ctxForAudit(ctx),accion:"DELEGAR_AUTORIDAD",entidad:"authority_delegations",entidadId:id,valorNuevo:{...input,sourceAuthoritySnapshot:source},motivo:input.reason,tx});
    });
    return db.query.authorityDelegations.findFirst({where:and(eq(authorityDelegations.tenantId,ctx.user.tenantId),eq(authorityDelegations.id,id))});
  }),

  revokeDelegation: authedQuery.input(z.object({id:z.number().int().positive(),motivo:z.string().trim().min(10)})).mutation(async({input,ctx})=>{
    const db=getDb();
    const current=await db.query.authorityDelegations.findFirst({where:and(eq(authorityDelegations.tenantId,ctx.user.tenantId),eq(authorityDelegations.id,input.id))});
    if(!current) throw new TRPCError({code:"NOT_FOUND",message:"Delegación no encontrada."});
    if(ctx.user.role!=="admin" && current.delegatorUserId!==ctx.user.id) throw new TRPCError({code:"FORBIDDEN",message:"Sólo el delegante o un administrador puede revocar."});
    await db.transaction(async tx=>{
      const res=await tx.update(authorityDelegations).set({active:false,revokedAt:new Date(),revokedBy:ctx.user.id})
        .where(and(eq(authorityDelegations.tenantId,ctx.user.tenantId),eq(authorityDelegations.id,input.id),eq(authorityDelegations.active,true)));
      if(Number(res[0]?.affectedRows??0)!==1) throw new TRPCError({code:"CONFLICT",message:"La delegación ya no está activa."});
      await writeAudit({ctx:ctxForAudit(ctx),accion:"REVOCAR_DELEGACION",entidad:"authority_delegations",entidadId:input.id,valorAnterior:current,motivo:input.motivo,tx});
    });
    return {success:true};
  }),
});
