import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { authedQuery, createRouter, ctxForAudit, procedureMutation } from "../middleware";
import { authorityDelegations, organizationalUnitMemberships, taskApprovals, workTasks, workflowInstances } from "@db/schema-eproc";
import { getDb } from "../queries/connection";
import { assertUnitAuthority } from "../lib/institutional-authority";
import { assertPreviousTasksCompleteInDb, assertTaskCommandAllowed, instantiateProcedureWorkflow, nextTaskState } from "../lib/workflow";
import { licitaciones } from "@db/schema";
import { licitacionIdFromInput } from "../lib/procedure-resolvers";
import { appendExpedienteEvent, findExpedienteByLicitacion } from "../lib/expediente";
import { writeAudit } from "../lib/security";

async function taskById(tenantId:number,id:number){
  return getDb().query.workTasks.findFirst({where:and(eq(workTasks.tenantId,tenantId),eq(workTasks.id,id))});
}

export const workRouter=createRouter({
  inbox:authedQuery.query(async({ctx})=>{
    const db=getDb(); const now=new Date();
    const [memberships,delegations]=await Promise.all([
      db.query.organizationalUnitMemberships.findMany({where:and(eq(organizationalUnitMemberships.tenantId,ctx.user.tenantId),eq(organizationalUnitMemberships.userId,ctx.user.id),eq(organizationalUnitMemberships.active,true))}),
      db.query.authorityDelegations.findMany({where:and(eq(authorityDelegations.tenantId,ctx.user.tenantId),eq(authorityDelegations.delegateeUserId,ctx.user.id),eq(authorityDelegations.active,true))}),
    ]);
    const unitIds=[...new Set([
      ...memberships.filter(m=>m.validFrom<=now&&(m.validUntil==null||m.validUntil>=now)).map(m=>m.unitId),
      ...delegations.filter(d=>d.revokedAt==null&&d.validFrom<=now&&d.validUntil>=now).map(d=>d.unitId),
    ])];
    if(!unitIds.length) return [];
    return db.query.workTasks.findMany({
      where:and(eq(workTasks.tenantId,ctx.user.tenantId),inArray(workTasks.assignedUnitId,unitIds)),
      orderBy:[asc(workTasks.dueAt),asc(workTasks.sequence)],
      limit:200,
    });
  }),

  initialize:procedureMutation({capability:"crear_procedimiento",role:"creador",resolveLicitacionId:(i)=>licitacionIdFromInput(i)})
    .input(z.object({id:z.number().int().positive(),motivo:z.string().trim().min(3)}))
    .mutation(async({input,ctx})=>{
      const db=getDb();
      const lic=await db.query.licitaciones.findFirst({where:and(eq(licitaciones.tenantId,ctx.user.tenantId),eq(licitaciones.id,input.id))});
      if(!lic||lic.contractingUnitId==null) throw new TRPCError({code:"PRECONDITION_FAILED",message:"El procedimiento requiere unidad compradora."});
      await db.transaction(async tx=>{
        await instantiateProcedureWorkflow(tx,{tenantId:ctx.user.tenantId,licitacionId:lic.id,unitId:lic.contractingUnitId!,actorUserId:ctx.user.id});
        await writeAudit({ctx:ctxForAudit(ctx),accion:"INICIALIZAR_WORKFLOW",entidad:"workflow_instances",entidadId:lic.id,motivo:input.motivo,tx});
      });
      return db.query.workflowInstances.findFirst({where:and(eq(workflowInstances.tenantId,ctx.user.tenantId),eq(workflowInstances.licitacionId,lic.id))});
    }),

  claim:authedQuery.input(z.object({id:z.number().int().positive()})).mutation(async({input,ctx})=>{
    const db=getDb(); const current=await taskById(ctx.user.tenantId,input.id);
    if(!current) throw new TRPCError({code:"NOT_FOUND",message:"Tarea no encontrada."});
    await assertUnitAuthority(ctx.user,current.assignedUnitId,[current.requiredRole as any],{licitacionId:current.licitacionId,actionCode:current.actionCode});
    const next=nextTaskState(current.state as any,"CLAIM");
    await db.transaction(async tx=>{
      await assertPreviousTasksCompleteInDb(tx,current);
      const res=await tx.update(workTasks).set({state:next,assignedUserId:ctx.user.id,claimedAt:new Date()})
        .where(and(eq(workTasks.tenantId,ctx.user.tenantId),eq(workTasks.id,current.id),inArray(workTasks.state,["PENDIENTE","DEVUELTA"])));
      if(Number(res[0]?.affectedRows??0)!==1) throw new TRPCError({code:"CONFLICT",message:"La tarea cambió de estado o ya fue tomada."});
      const expediente=await findExpedienteByLicitacion(ctx.user.tenantId,current.licitacionId);
      if(expediente) await appendExpedienteEvent(tx,ctx,{expedienteId:expediente.id,tipo:"WORK_TASK_CLAIMED",estadoAnterior:current.state,estadoNuevo:next,motivo:"Tarea tomada",payload:{taskId:current.id,actionCode:current.actionCode}});
      await writeAudit({ctx:ctxForAudit(ctx),accion:"CLAIM_TASK",entidad:"work_tasks",entidadId:current.id,valorAnterior:current,valorNuevo:{state:next,assignedUserId:ctx.user.id},tx});
    });
    return taskById(ctx.user.tenantId,current.id);
  }),

  complete:authedQuery.input(z.object({id:z.number().int().positive(),motivo:z.string().trim().min(3)})).mutation(async({input,ctx})=>{
    const db=getDb(); const current=await taskById(ctx.user.tenantId,input.id);
    if(!current) throw new TRPCError({code:"NOT_FOUND",message:"Tarea no encontrada."});
    if(current.assignedUserId!==ctx.user.id||current.state!=="EN_PROGRESO") throw new TRPCError({code:"FORBIDDEN",message:"La tarea debe estar EN_PROGRESO y asignada al actor."});
    assertTaskCommandAllowed(current.completionMode as any, "APPROVE");
    const authority=await assertUnitAuthority(ctx.user,current.assignedUnitId,[current.requiredRole as any],{licitacionId:current.licitacionId,actionCode:current.actionCode});
    const next=nextTaskState(current.state as any,"APPROVE");
    await db.transaction(async tx=>{
      const previous=await assertPreviousTasksCompleteInDb(tx,current);
      if(current.completionMode==="APPROVE"){
        const previousActor=[...previous].sort((a,b)=>b.sequence-a.sequence).find(p=>p.assignedUserId!=null)?.assignedUserId;
        if(previousActor===ctx.user.id) throw new TRPCError({code:"FORBIDDEN",message:"Four-eyes: el aprobador no puede ser quien ejecutó la tarea previa."});
        await tx.insert(taskApprovals).values({tenantId:ctx.user.tenantId,taskId:current.id,level:1,approverUserId:ctx.user.id,authoritySnapshot:authority,decision:"APPROVED",reason:input.motivo});
      }
      const res=await tx.update(workTasks).set({state:next,completedAt:new Date()})
        .where(and(eq(workTasks.tenantId,ctx.user.tenantId),eq(workTasks.id,current.id),eq(workTasks.state,"EN_PROGRESO"),eq(workTasks.assignedUserId,ctx.user.id)));
      if(Number(res[0]?.affectedRows??0)!==1) throw new TRPCError({code:"CONFLICT",message:"La tarea cambió de estado."});
      const expediente=await findExpedienteByLicitacion(ctx.user.tenantId,current.licitacionId);
      if(expediente) await appendExpedienteEvent(tx,ctx,{expedienteId:expediente.id,tipo:"WORK_TASK_COMPLETED",estadoAnterior:current.state,estadoNuevo:next,motivo:input.motivo,payload:{taskId:current.id,actionCode:current.actionCode,completionMode:current.completionMode,authority}});
      await writeAudit({ctx:ctxForAudit(ctx),accion:"COMPLETE_TASK",entidad:"work_tasks",entidadId:current.id,valorAnterior:current,valorNuevo:{state:next,authority},motivo:input.motivo,tx});
    });
    return taskById(ctx.user.tenantId,current.id);
  }),

  submit:authedQuery.input(z.object({id:z.number().int().positive(),motivo:z.string().trim().min(3)})).mutation(async({input,ctx})=>{
    const db=getDb(); const current=await taskById(ctx.user.tenantId,input.id);
    if(!current) throw new TRPCError({code:"NOT_FOUND",message:"Tarea no encontrada."});
    if(current.assignedUserId!==ctx.user.id) throw new TRPCError({code:"FORBIDDEN",message:"Sólo el responsable puede enviar a revisión."});
    assertTaskCommandAllowed(current.completionMode as any, "SUBMIT");
    const next=nextTaskState(current.state as any,"SUBMIT");
    await db.transaction(async tx=>{
      const res=await tx.update(workTasks).set({state:next}).where(and(eq(workTasks.tenantId,ctx.user.tenantId),eq(workTasks.id,current.id),eq(workTasks.state,"EN_PROGRESO")));
      if(Number(res[0]?.affectedRows??0)!==1) throw new TRPCError({code:"CONFLICT",message:"La tarea cambió de estado."});
      await writeAudit({ctx:ctxForAudit(ctx),accion:"SUBMIT_TASK",entidad:"work_tasks",entidadId:current.id,valorAnterior:current,valorNuevo:{state:next},motivo:input.motivo,tx});
    });
    return taskById(ctx.user.tenantId,current.id);
  }),

  decide:authedQuery.input(z.object({id:z.number().int().positive(),decision:z.enum(["APPROVE","REJECT","RETURN"]),motivo:z.string().trim().min(3)})).mutation(async({input,ctx})=>{
    const db=getDb(); const current=await taskById(ctx.user.tenantId,input.id);
    if(!current) throw new TRPCError({code:"NOT_FOUND",message:"Tarea no encontrada."});
    if(current.state!=="EN_REVISION") throw new TRPCError({code:"CONFLICT",message:"La tarea no está EN_REVISION."});
    if(current.assignedUserId===ctx.user.id) throw new TRPCError({code:"FORBIDDEN",message:"Four-eyes: quien ejecutó no decide su propia revisión."});
    const authority=await assertUnitAuthority(ctx.user,current.assignedUnitId,[current.requiredRole as any],{licitacionId:current.licitacionId,actionCode:current.actionCode});
    const next=nextTaskState(current.state as any,input.decision);
    await db.transaction(async tx=>{
      await tx.insert(taskApprovals).values({tenantId:ctx.user.tenantId,taskId:current.id,level:1,approverUserId:ctx.user.id,authoritySnapshot:authority,decision:input.decision==="APPROVE"?"APPROVED":input.decision==="RETURN"?"RETURNED":"REJECTED",reason:input.motivo});
      const res=await tx.update(workTasks).set({state:next,assignedUserId:input.decision==="RETURN"?null:current.assignedUserId,completedAt:["APROBADA","RECHAZADA"].includes(next)?new Date():null})
        .where(and(eq(workTasks.tenantId,ctx.user.tenantId),eq(workTasks.id,current.id),eq(workTasks.state,"EN_REVISION")));
      if(Number(res[0]?.affectedRows??0)!==1) throw new TRPCError({code:"CONFLICT",message:"La tarea cambió de estado."});
      await writeAudit({ctx:ctxForAudit(ctx),accion:"DECIDE_TASK",entidad:"work_tasks",entidadId:current.id,valorAnterior:current,valorNuevo:{state:next,authority},motivo:input.motivo,tx});
    });
    return taskById(ctx.user.tenantId,current.id);
  }),
});
