import { Link, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ShieldCheck, FileCheck2, History } from "lucide-react";

const labels: Record<string,string> = { PENDIENTE:"Pendiente", CUMPLIDO:"Cumplido", OBSERVADO:"Observado", NO_APLICA:"No aplica" };

export default function ExpedienteDetalle(){
  const { id } = useParams(); const expedienteId=Number(id);
  const reqs=trpc.expedientes.requirements.useQuery({expedienteId},{enabled:Number.isInteger(expedienteId)&&expedienteId>0});
  const events=trpc.expedientes.events.useQuery({expedienteId},{enabled:Number.isInteger(expedienteId)&&expedienteId>0});
  const verify=trpc.expedientes.verifyEvidence.useQuery({expedienteId},{enabled:Number.isInteger(expedienteId)&&expedienteId>0});
  const send=trpc.expedientes.enviarRevisionJuridica.useMutation({onSuccess:()=>{reqs.refetch();verify.refetch()}});
  const resolve=trpc.expedientes.resolverRevision.useMutation({onSuccess:()=>{reqs.refetch();verify.refetch()}});
  if(!Number.isInteger(expedienteId)||expedienteId<=0) return <p className="text-red-400">Expediente inválido.</p>;
  return <div className="space-y-6">
    <div className="flex items-center gap-3"><Link to="/expedientes"><Button variant="ghost" size="icon" className="text-slate-400"><ArrowLeft className="w-5 h-5"/></Button></Link><div><h2 className="text-2xl font-bold text-white">Expediente #{expedienteId}</h2><p className="text-sm text-slate-400">Requisitos, evidencia y cadena de eventos.</p></div></div>
    <Card className="border-slate-700 bg-slate-800/50"><CardHeader><CardTitle className="text-white flex items-center justify-between"><span>Requisitos de integración</span><Link to={`/documentos?expedienteId=${expedienteId}`}><Button size="sm" variant="outline" className="border-slate-600 text-slate-300"><FileCheck2 className="w-4 h-4 mr-2"/>Documentos</Button></Link></CardTitle></CardHeader><CardContent className="space-y-3">
      {(reqs.data||[]).map((r:any)=><div key={r.id} className="flex items-center justify-between gap-3 border-b border-slate-700 pb-3"><div><p className="text-sm text-white font-medium">{r.nombre}</p><p className="text-xs text-slate-500">{r.codigo} · {r.tipoDocumento}</p>{r.observaciones&&<p className="text-xs text-red-300 mt-1">{r.observaciones}</p>}</div><Badge className={r.estado==="CUMPLIDO"?"bg-emerald-800 text-emerald-200":"bg-slate-700 text-slate-200"}>{labels[r.estado]||r.estado}</Badge></div>)}
      {(!reqs.data||reqs.data.length===0)&&<p className="text-slate-500">Sin requisitos cargados.</p>}
    </CardContent></Card>
    <Card className="border-slate-700 bg-slate-800/50"><CardHeader><CardTitle className="text-white">Control de workflow jurídico</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-slate-300">El expediente es aprobado antes de permitir la publicación del procedimiento.</p>
      <div className="flex gap-2 flex-wrap">
        <Button onClick={()=>{const m=window.prompt("Motivo");if(m)send.mutate({expedienteId,motivo:m})}} disabled={send.isPending}>Enviar a revisión</Button>
        <Button className="bg-emerald-700" onClick={()=>{const m=window.prompt("Motivo de aprobación");if(m)resolve.mutate({expedienteId,decision:"APROBAR",motivo:m})}} disabled={resolve.isPending}><ShieldCheck className="w-4 h-4 mr-2"/>Aprobar</Button>
        <Button variant="outline" className="border-red-800 text-red-300" onClick={()=>{const m=window.prompt("Observaciones");if(m)resolve.mutate({expedienteId,decision:"OBSERVAR",motivo:m})}} disabled={resolve.isPending}>Observar</Button>
      </div>
      <div className="text-xs text-slate-500">La consulta de estado de evidencia se expone abajo mediante verificación criptográfica.</div>
      <pre className="text-xs text-slate-400 bg-slate-900/60 p-3 rounded">{JSON.stringify(verify.data??{validando:true},null,2)}</pre>
    </CardContent></Card>
    <Card className="border-slate-700 bg-slate-800/50"><CardHeader><CardTitle className="text-white flex items-center gap-2"><History className="w-4 h-4"/> Cadena de eventos</CardTitle></CardHeader><CardContent className="space-y-2">{(events.data||[]).map((e:any)=><div key={e.id} className="border-l-2 border-slate-600 pl-3"><p className="text-sm text-white">#{e.secuencia} · {e.tipo}</p><p className="text-xs text-slate-500">{e.estadoAnterior||"—"} → {e.estadoNuevo||"—"} · {new Date(e.timestamp).toLocaleString("es-MX")}</p><p className="text-[11px] text-slate-600 break-all">hash: {e.eventHash}</p></div>)}</CardContent></Card>
  </div>;
}
