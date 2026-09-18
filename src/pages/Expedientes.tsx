import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileCheck2, ShieldCheck, Eye, RefreshCcw } from "lucide-react";
import { useState } from "react";

const stateLabel: Record<string,string> = {
  INTEGRACION: "Integración",
  REVISION_JURIDICA: "Revisión jurídica",
  APROBADO: "Aprobado",
  OBSERVADO: "Observado",
  CERRADO: "Cerrado",
  ARCHIVADO: "Archivado",
};

export default function Expedientes() {
  const [page, setPage] = useState(1);
  const q = trpc.expedientes.list.useQuery({ page, pageSize: 20 });
  const send = trpc.expedientes.enviarRevisionJuridica.useMutation({ onSuccess: () => q.refetch() });
  const resolve = trpc.expedientes.resolverRevision.useMutation({ onSuccess: () => q.refetch() });

  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-3">
      <div><h2 className="text-2xl font-bold text-white">Expedientes electrónicos</h2><p className="text-sm text-slate-400">Aggregate central de cada procedimiento. Documentos, requisitos y eventos quedan gobernados por el expediente.</p></div>
      <Button variant="outline" className="border-slate-600 text-slate-300" onClick={() => q.refetch()}><RefreshCcw className="w-4 h-4 mr-2"/>Actualizar</Button>
    </div>
    <Card className="border-slate-700 bg-slate-800/50"><CardHeader><CardTitle className="text-white">Estado de integración</CardTitle></CardHeader><CardContent>
      <div className="space-y-3">
        {q.isLoading ? <p className="text-slate-400">Cargando…</p> : q.data?.items.map((e:any) => <div key={e.id} className="rounded-lg border border-slate-700 p-4 flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
          <div className="min-w-0"><p className="font-mono text-xs text-amber-400">{e.folio}</p><p className="text-white font-semibold truncate">{e.licitacion?.codigo} · {e.licitacion?.titulo}</p><p className="text-xs text-slate-400">Marco: {e.marcoJuridico} · Versión {e.version}</p></div>
          <div className="flex items-center gap-2 flex-wrap"><Badge className="bg-slate-700 text-slate-200">{stateLabel[e.estado] || e.estado}</Badge><Link to={`/expedientes/${e.id}`}><Button size="sm" variant="outline" className="border-slate-600 text-slate-300"><Eye className="w-4 h-4 mr-1"/>Expediente</Button></Link>
          {e.estado === "INTEGRACION" || e.estado === "OBSERVADO" ? <Button size="sm" className="bg-amber-600" onClick={() => { const motivo = window.prompt("Motivo de envío a revisión jurídica"); if (motivo) send.mutate({ expedienteId: e.id, motivo }); }} disabled={send.isPending}><FileCheck2 className="w-4 h-4 mr-1"/>Enviar a revisión</Button> : null}
          {e.estado === "REVISION_JURIDICA" ? <><Button size="sm" className="bg-emerald-700" onClick={() => { const motivo = window.prompt("Motivo de aprobación jurídica"); if (motivo) resolve.mutate({ expedienteId: e.id, decision: "APROBAR", motivo }); }} disabled={resolve.isPending}><ShieldCheck className="w-4 h-4 mr-1"/>Aprobar</Button><Button size="sm" variant="outline" className="border-red-800 text-red-300" onClick={() => { const motivo = window.prompt("Observaciones jurídicas"); if (motivo) resolve.mutate({ expedienteId: e.id, decision: "OBSERVAR", motivo }); }} disabled={resolve.isPending}>Observar</Button></> : null}
          </div>
        </div>)}
      </div>
      <div className="flex justify-between mt-5"><Button disabled={page<=1} variant="outline" onClick={()=>setPage(p=>p-1)}>Anterior</Button><span className="text-sm text-slate-400">Página {q.data?.page ?? page} de {q.data?.pageCount ?? 1}</span><Button disabled={!q.data || page >= q.data.pageCount} variant="outline" onClick={()=>setPage(p=>p+1)}>Siguiente</Button></div>
    </CardContent></Card>
    <p className="text-xs text-slate-500">La revisión jurídica representa control interno del expediente; no sustituye la determinación jurídica de la autoridad competente ni la firma electrónica que se integrará en una fase posterior.</p>
  </div>;
}
