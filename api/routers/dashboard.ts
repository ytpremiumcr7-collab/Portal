import { eq, count, sql, and } from "drizzle-orm";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { licitaciones, proveedores, participaciones, alertasSeguridad } from "@db/schema";
export const dashboardRouter=createRouter({
 metrics:authedQuery.query(async({ctx})=>{const db=getDb();const [activas,adjudicadas,monto,prov,ofertas,alertas]=await Promise.all([
 db.select({count:count()}).from(licitaciones).where(and(eq(licitaciones.tenantId,ctx.user.tenantId),eq(licitaciones.estado,"PUBLICADA"))),
 db.select({count:count()}).from(licitaciones).where(and(eq(licitaciones.tenantId,ctx.user.tenantId),eq(licitaciones.estado,"ADJUDICADA"))),
 db.select({total:sql<string>`COALESCE(SUM(${licitaciones.montoAdjudicado}),0)`}).from(licitaciones).where(and(eq(licitaciones.tenantId,ctx.user.tenantId),eq(licitaciones.estado,"ADJUDICADA"))),
 db.select({count:count()}).from(proveedores).where(and(eq(proveedores.tenantId,ctx.user.tenantId),eq(proveedores.estadoVerificacion,"VERIFICADO"))),
 db.select({count:count()}).from(participaciones).where(eq(participaciones.tenantId,ctx.user.tenantId)),
 db.select({count:count()}).from(alertasSeguridad).where(and(eq(alertasSeguridad.tenantId,ctx.user.tenantId),eq(alertasSeguridad.estado,"NUEVA"),sql`${alertasSeguridad.severidad} IN ('ALTA','CRITICA')`))
 ]);return{licitacionesActivas:Number(activas[0]?.count??0),licitacionesAdjudicadasPeriodo:Number(adjudicadas[0]?.count??0),montoTotalAdjudicadoPeriodo:Number(monto[0]?.total??0),proveedoresActivos:Number(prov[0]?.count??0),ofertasRecibidasPeriodo:Number(ofertas[0]?.count??0),alertasUrgentes:Number(alertas[0]?.count??0)};}),
 recentLicitaciones:authedQuery.query(async({ctx})=>{const where=ctx.user.role==="proveedor"?and(eq(licitaciones.tenantId,ctx.user.tenantId),eq(licitaciones.estado,"PUBLICADA")):eq(licitaciones.tenantId,ctx.user.tenantId);return getDb().query.licitaciones.findMany({where,orderBy:[sql`${licitaciones.createdAt} DESC`],limit:5,with:{entidad:true,categoria:true}})}),
 recentAlertas:authedQuery.query(async({ctx})=>{if(ctx.user.role==="proveedor")return [];return getDb().query.alertasSeguridad.findMany({where:eq(alertasSeguridad.tenantId,ctx.user.tenantId),orderBy:[sql`${alertasSeguridad.creadaEn} DESC`],limit:5,with:{licitacion:true,proveedor:true}})}),
});
