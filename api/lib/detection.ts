import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { alertasSeguridad, licitaciones, proveedores } from "@db/schema";

async function createAlert(tenantId:number,data:{tipo:any;severidad:any;score:number;regla:string;evidencia:string;licitacionId?:number;proveedorId?:number}){
 const db=getDb();
 const existing=await db.query.alertasSeguridad.findFirst({where:and(eq(alertasSeguridad.tenantId,tenantId),eq(alertasSeguridad.licitacionId,data.licitacionId ?? 0),eq(alertasSeguridad.proveedorId,data.proveedorId ?? 0),eq(alertasSeguridad.regla,data.regla),eq(alertasSeguridad.estado,"NUEVA"))});
 if(existing)return existing;
 const codigo=`ARES-ALT-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
 const result=await db.insert(alertasSeguridad).values({tenantId,codigo,tipo:data.tipo,severidad:data.severidad,score:Math.min(100,Math.max(0,data.score)).toFixed(2),regla:data.regla,evidencia:data.evidencia,licitacionId:data.licitacionId??null,proveedorId:data.proveedorId??null,descripcion:data.evidencia,estado:"NUEVA",detectadaAutomaticamente:true});
 return db.query.alertasSeguridad.findFirst({where:and(eq(alertasSeguridad.id,Number(result[0].insertId)),eq(alertasSeguridad.tenantId,tenantId))});
}

export async function detectLicitacionRisks(tenantId:number,licitacionId:number){
 const db=getDb(); const lic=await db.query.licitaciones.findFirst({where:and(eq(licitaciones.id,licitacionId),eq(licitaciones.tenantId,tenantId)),with:{participaciones:true}}); if(!lic)return [];
 const offers=lic.participaciones.filter(x=>Number(x.montoOferta)>0); const created:any[]=[];
 if(offers.length>=2){
  const amounts=offers.map(x=>Number(x.montoOferta)); const budget=Number(lic.montoPresupuestado); const avg=amounts.reduce((a,b)=>a+b,0)/amounts.length;
  if(budget>0){for(const o of offers){const ratio=Number(o.montoOferta)/budget;if(ratio>1.25||ratio<0.75){const score=Math.min(100,Math.abs(ratio-1)*200);const p=await db.query.proveedores.findFirst({where:and(eq(proveedores.id,o.proveedorId),eq(proveedores.tenantId,tenantId))});const a=await createAlert(tenantId,{tipo:"ANOMALIA_PRECIO",severidad:score>=70?"CRITICA":score>=45?"ALTA":"MEDIA",score,regla:"OFERTA_FUERA_RANGO_PRESUPUESTO",evidencia:`Oferta ${o.montoOferta} MXN = ${(ratio*100).toFixed(2)}% del presupuesto ${lic.montoPresupuestado} MXN. Media: ${avg.toFixed(2)} MXN.`,licitacionId,proveedorId:p?.id});if(a)created.push(a);}}}
  for(let i=0;i<offers.length;i++)for(let j=i+1;j<offers.length;j++){const a=Number(offers[i].montoOferta),b=Number(offers[j].montoOferta),delta=Math.abs(a-b)/Math.max(a,b);if(delta<=0.005){const a1=await createAlert(tenantId,{tipo:"COLUSION_SOSPECHADA",severidad:"ALTA",score:80,regla:"OFERTAS_CASI_IDENTICAS",evidencia:`Las ofertas ${offers[i].id} y ${offers[j].id} difieren ${ (delta*100).toFixed(3)}%. Indicador heurístico; requiere revisión humana.`,licitacionId});if(a1)created.push(a1);}}
 }
 const past=await db.query.licitaciones.findMany({where:and(eq(licitaciones.tenantId,tenantId),eq(licitaciones.estado,"ADJUDICADA")),with:{participaciones:true},limit:100}); const wins=new Map<number,number>(); for(const p of past.flatMap(x=>x.participaciones.filter(y=>y.estadoEvaluacion==="GANADORA")))wins.set(p.proveedorId,(wins.get(p.proveedorId)||0)+1);
 for(const [providerId,n] of wins)if(n>=3){const a=await createAlert(tenantId,{tipo:"PATRON_ROTACION",severidad:"MEDIA",score:65,regla:"CONCENTRACION_GANADORA_HISTORICA",evidencia:`El proveedor ${providerId} acumula ${n} adjudicaciones en el historial analizado. Indicador de revisión, no conclusión de irregularidad.`,licitacionId,proveedorId:providerId});if(a)created.push(a);}
 return created;
}
