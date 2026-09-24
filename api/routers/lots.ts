import { z } from "zod";
import { and, asc, count, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { authedQuery, createRouter, ctxForAudit, procedureMutation } from "../middleware";
import { licitaciones, participaciones } from "@db/schema";
import { procedureItems, procedureLots } from "@db/schema-eproc";
import { getDb } from "../queries/connection";
import { licitacionIdFromInput } from "../lib/procedure-resolvers";
import { appendExpedienteEvent, findExpedienteByLicitacion } from "../lib/expediente";
import { writeAudit } from "../lib/security";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido.");
const quantity = z.string().regex(/^\d+(\.\d{1,4})?$/, "Cantidad inválida.");

async function assertEditableProcedure(tenantId:number, licitacionId:number) {
  const lic = await getDb().query.licitaciones.findFirst({
    where: and(eq(licitaciones.tenantId, tenantId), eq(licitaciones.id, licitacionId)),
  });
  if (!lic) throw new TRPCError({ code:"NOT_FOUND", message:"Procedimiento no encontrado." });
  if (lic.estado !== "BORRADOR") {
    throw new TRPCError({ code:"CONFLICT", message:"Los lotes e ítems sólo se modifican mientras el procedimiento está BORRADOR." });
  }
  return lic;
}

export const lotsRouter = createRouter({
  list: authedQuery.input(z.object({ licitacionId:z.number().int().positive() })).query(async({input,ctx})=>{
    const db=getDb();
    const lots=await db.query.procedureLots.findMany({
      where:and(eq(procedureLots.tenantId,ctx.user.tenantId),eq(procedureLots.licitacionId,input.licitacionId)),
      orderBy:[asc(procedureLots.id)],
    });
    const items=await db.query.procedureItems.findMany({
      where:and(eq(procedureItems.tenantId,ctx.user.tenantId),eq(procedureItems.licitacionId,input.licitacionId)),
      orderBy:[asc(procedureItems.id)],
    });
    return lots.map(l=>({...l,items:items.filter(i=>i.lotId===l.id)}));
  }),

  createLot: procedureMutation({capability:"crear_procedimiento",role:"creador",resolveLicitacionId:(i)=>licitacionIdFromInput(i)})
    .input(z.object({
      licitacionId:z.number().int().positive(),code:z.string().trim().min(1).max(80),
      title:z.string().trim().min(3).max(240),description:z.string().trim().optional(),
      estimatedAmount:money.optional(),motivo:z.string().trim().min(3),
    })).mutation(async({input,ctx})=>{
      await assertEditableProcedure(ctx.user.tenantId,input.licitacionId);
      const db=getDb();
      const expediente=await findExpedienteByLicitacion(ctx.user.tenantId,input.licitacionId);
      let id=0;
      await db.transaction(async tx=>{
        const code=input.code.toUpperCase();
        const dup=await tx.query.procedureLots.findFirst({where:and(
          eq(procedureLots.tenantId,ctx.user.tenantId),eq(procedureLots.licitacionId,input.licitacionId),eq(procedureLots.code,code),
        )});
        if(dup) throw new TRPCError({code:"CONFLICT",message:"Ya existe un lote con ese código."});

        if(code!=="GENERAL"){
          const general=await tx.query.procedureLots.findFirst({where:and(
            eq(procedureLots.tenantId,ctx.user.tenantId),eq(procedureLots.licitacionId,input.licitacionId),eq(procedureLots.code,"GENERAL"),
          )});
          if(general && general.status!=="CANCELLED"){
            const used=await tx.select({total:count()}).from(participaciones).where(and(
              eq(participaciones.tenantId,ctx.user.tenantId),eq(participaciones.lotId,general.id),
            ));
            if(Number(used[0]?.total??0)>0) throw new TRPCError({code:"CONFLICT",message:"El lote GENERAL ya tiene proposiciones y no puede sustituirse."});
            await tx.update(procedureLots).set({status:"CANCELLED"}).where(and(
              eq(procedureLots.tenantId,ctx.user.tenantId),eq(procedureLots.id,general.id),
            ));
          }
        }

        const result=await tx.insert(procedureLots).values({
          tenantId:ctx.user.tenantId,licitacionId:input.licitacionId,code,title:input.title,
          description:input.description??null,status:"ACTIVE",estimatedAmount:input.estimatedAmount??null,
          currency:"MXN",createdBy:ctx.user.id,
        });
        id=Number(result[0].insertId);
        if(expediente) await appendExpedienteEvent(tx,ctx,{
          expedienteId:expediente.id,tipo:"LOTE_CREADO",estadoAnterior:null,estadoNuevo:"ACTIVE",
          motivo:input.motivo,payload:{lotId:id,code,title:input.title,estimatedAmount:input.estimatedAmount??null},
        });
        await writeAudit({ctx:ctxForAudit(ctx),accion:"CREAR_LOTE",entidad:"procedure_lots",entidadId:id,valorNuevo:{...input,code},motivo:input.motivo,tx});
      });
      return db.query.procedureLots.findFirst({where:and(eq(procedureLots.tenantId,ctx.user.tenantId),eq(procedureLots.id,id))});
    }),

  addItem: procedureMutation({capability:"crear_procedimiento",role:"creador",resolveLicitacionId:(i)=>licitacionIdFromInput(i)})
    .input(z.object({
      licitacionId:z.number().int().positive(),lotId:z.number().int().positive(),
      code:z.string().trim().min(1).max(80),description:z.string().trim().min(3),
      quantity,unit:z.string().trim().min(1).max(80),estimatedUnitPrice:money.optional(),
      classificationCode:z.string().trim().max(80).optional(),motivo:z.string().trim().min(3),
    })).mutation(async({input,ctx})=>{
      await assertEditableProcedure(ctx.user.tenantId,input.licitacionId);
      const db=getDb();
      const lot=await db.query.procedureLots.findFirst({where:and(
        eq(procedureLots.tenantId,ctx.user.tenantId),eq(procedureLots.id,input.lotId),eq(procedureLots.licitacionId,input.licitacionId),
      )});
      if(!lot||!["DRAFT","ACTIVE"].includes(lot.status)) throw new TRPCError({code:"BAD_REQUEST",message:"Lote inexistente o no editable."});
      if(Number(input.quantity)<=0) throw new TRPCError({code:"BAD_REQUEST",message:"La cantidad debe ser mayor que cero."});
      const expediente=await findExpedienteByLicitacion(ctx.user.tenantId,input.licitacionId);
      let id=0;
      await db.transaction(async tx=>{
        const result=await tx.insert(procedureItems).values({
          tenantId:ctx.user.tenantId,licitacionId:input.licitacionId,lotId:input.lotId,
          code:input.code.toUpperCase(),description:input.description,quantity:input.quantity,unit:input.unit,
          estimatedUnitPrice:input.estimatedUnitPrice??null,classificationCode:input.classificationCode??null,
        });
        id=Number(result[0].insertId);
        if(expediente) await appendExpedienteEvent(tx,ctx,{
          expedienteId:expediente.id,tipo:"LOTE_ITEM_AGREGADO",estadoAnterior:null,estadoNuevo:"ACTIVE",
          motivo:input.motivo,payload:{lotId:input.lotId,itemId:id,code:input.code,quantity:input.quantity,unit:input.unit},
        });
        await writeAudit({ctx:ctxForAudit(ctx),accion:"AGREGAR_ITEM_LOTE",entidad:"procedure_items",entidadId:id,valorNuevo:input,motivo:input.motivo,tx});
      });
      return db.query.procedureItems.findFirst({where:and(eq(procedureItems.tenantId,ctx.user.tenantId),eq(procedureItems.id,id))});
    }),
});
