import { useParams, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, Building2, Users, Trophy, ShieldCheck, Gavel } from "lucide-react";

export default function LicitacionDetalle() {
  const { id } = useParams<{ id: string }>();
  const licId = parseInt(id || "0");

  const { data: lic, isLoading } = trpc.licitaciones.getById.useQuery({ id: licId });
  const utils = trpc.useUtils();
  const evaluate = trpc.participaciones.evaluar.useMutation({ onSuccess:()=>utils.licitaciones.getById.invalidate({id:licId}) });
  const startEvaluation = trpc.licitaciones.iniciarEvaluacion.useMutation({ onSuccess:()=>utils.licitaciones.getById.invalidate({id:licId}) });
  const detect = trpc.alertas.detectar.useMutation();
  const adjudicate = trpc.licitaciones.adjudicar.useMutation({ onSuccess:()=>utils.licitaciones.getById.invalidate({id:licId}) });

  const formatCurrency = (value: string | null) => {
    if (!value) return "$0";
    return new Intl.NumberFormat("es-MX", {
      style: "currency", currency: "MXN", minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(parseFloat(value));
  };

  const formatDate = (value: Date | string | null) => {
    if (!value) return "-";
    if (value instanceof Date) return value.toLocaleDateString("es-MX");
    return value;
  };

  const getEstadoBadge = (estado: string) => {
    const v: Record<string, string> = {
      BORRADOR: "bg-slate-600 text-slate-200",
      PUBLICADA: "bg-emerald-600 text-emerald-100",
      EN_EVALUACION: "bg-blue-600 text-blue-100",
      ADJUDICADA: "bg-purple-600 text-purple-100",
      FINALIZADA: "bg-slate-600 text-slate-200",
      CANCELADA: "bg-red-600 text-red-100",
    };
    return v[estado] || "bg-slate-600";
  };

  if (isLoading) return <p className="text-slate-400 text-center py-8">Cargando...</p>;
  if (!lic) return <p className="text-slate-400 text-center py-8">Licitacion no encontrada</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/licitaciones">
          <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-amber-500">{lic.codigo}</span>
            <Badge className={`text-xs ${getEstadoBadge(lic.estado)}`}>{lic.estado.replace(/_/g, " ")}</Badge>
          </div>
          <h2 className="text-xl font-bold text-white">{lic.titulo}</h2>
        </div>
      </div>

      <Card className="border-slate-700 bg-slate-800/50"><CardContent className="p-4 flex flex-wrap gap-2">
        {(lic.estado === "PUBLICADA" || lic.estado === "CONSULTAS") && <Button onClick={()=>startEvaluation.mutate({id:lic.id,motivo:"Inicio de evaluación desde expediente"})} disabled={startEvaluation.isPending} className="bg-blue-600"><Gavel className="w-4 h-4 mr-2"/>Iniciar evaluación</Button>}
        {lic.estado === "EN_EVALUACION" && <Button onClick={()=>detect.mutate({licitacionId:lic.id,motivo:"Análisis heurístico de riesgo"})} disabled={detect.isPending} className="bg-red-700"><ShieldCheck className="w-4 h-4 mr-2"/>Analizar riesgos</Button>}
        <Link to={`/documentos?licitacionId=${lic.id}`}><Button variant="outline" className="border-slate-600 text-slate-300">Gestionar expediente</Button></Link>
        <Link to={`/hitos?licitacionId=${lic.id}`}><Button variant="outline" className="border-slate-600 text-slate-300">Gestionar hitos</Button></Link>
      </CardContent></Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-slate-700 bg-slate-800/50">
          <CardHeader><CardTitle className="text-white text-base flex items-center gap-2"><FileText className="w-4 h-4 text-amber-500" /> Informacion General</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-slate-400">Entidad</p><p className="text-sm text-white">{lic.entidad?.razonSocial}</p></div>
              <div><p className="text-xs text-slate-400">Categoria</p><p className="text-sm text-white">{lic.categoria?.nombre}</p></div>
              <div><p className="text-xs text-slate-400">Tipo</p><p className="text-sm text-white">{lic.tipoLicitacion?.replace(/_/g, " ")}</p></div>
              <div><p className="text-xs text-slate-400">Contratacion</p><p className="text-sm text-white">{lic.tipoContratacion}</p></div>
              <div><p className="text-xs text-slate-400">Monto Presupuestado</p><p className="text-sm text-white font-semibold">{formatCurrency(lic.montoPresupuestado)}</p></div>
              <div><p className="text-xs text-slate-400">Moneda</p><p className="text-sm text-white">{lic.moneda}</p></div>
              {lic.fechaPublicacion && <div><p className="text-xs text-slate-400">Fecha Publicacion</p><p className="text-sm text-white">{formatDate(lic.fechaPublicacion)}</p></div>}
              {lic.fechaCierre && <div><p className="text-xs text-slate-400">Fecha Cierre</p><p className="text-sm text-white">{formatDate(lic.fechaCierre)}</p></div>}
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-700 bg-slate-800/50">
          <CardHeader><CardTitle className="text-white text-base flex items-center gap-2"><Building2 className="w-4 h-4 text-amber-500" /> Objeto</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-slate-300">{lic.objeto}</p>
            {lic.descripcionDetallada && <p className="text-sm text-slate-400 mt-2">{lic.descripcionDetallada}</p>}
          </CardContent>
        </Card>
      </div>

      {lic.proveedorGanador && (
        <Card className="border-slate-700 bg-slate-800/50 border-l-4 border-l-purple-500">
          <CardHeader><CardTitle className="text-white text-base flex items-center gap-2"><Trophy className="w-4 h-4 text-purple-500" /> Adjudicacion</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <div><p className="text-xs text-slate-400">Ganador</p><p className="text-sm text-white font-semibold">{lic.proveedorGanador.razonSocial}</p></div>
            <div><p className="text-xs text-slate-400">Monto Adjudicado</p><p className="text-sm text-white font-semibold">{formatCurrency(lic.montoAdjudicado)}</p></div>
            <div><p className="text-xs text-slate-400">Fecha</p><p className="text-sm text-white">{formatDate(lic.fechaAdjudicacion)}</p></div>
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white text-base flex items-center gap-2"><Users className="w-4 h-4 text-amber-500" /> Participaciones ({lic.participaciones?.length || 0})</CardTitle></CardHeader>
        <CardContent>
          {lic.participaciones?.length === 0 ? (
            <p className="text-slate-500 text-center py-4">Sin participaciones</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-slate-700">
                  <th className="text-left py-2 px-3 text-xs text-slate-400">Proveedor</th>
                  <th className="text-right py-2 px-3 text-xs text-slate-400">Oferta</th>
                  <th className="text-left py-2 px-3 text-xs text-slate-400">Estado</th>
                  <th className="text-right py-2 px-3 text-xs text-slate-400">Puntaje</th><th className="text-right py-2 px-3 text-xs text-slate-400">Acción</th>
                </tr></thead>
                <tbody>
                  {lic.participaciones?.map((p: any) => (
                    <tr key={p.id} className="hover:bg-slate-700/30">
                      <td className="py-2 px-3 text-sm text-white">{p.proveedor?.razonSocial}</td>
                      <td className="py-2 px-3 text-sm text-white text-right">{formatCurrency(p.montoOferta)}</td>
                      <td className="py-2 px-3"><Badge className="text-xs bg-slate-600">{p.estadoEvaluacion.replace(/_/g, " ")}</Badge></td>
                      <td className="py-2 px-3 text-sm text-white text-right">{p.puntajeTotal || "-"}</td>
                      <td className="py-2 px-3 text-right">{lic.estado === "EN_EVALUACION" && p.estadoEvaluacion === "PENDIENTE" && <Button size="sm" onClick={()=>{
 const rubric=lic.rubricaTecnica?JSON.parse(lic.rubricaTecnica):null;
 if(rubric&&lic.modoEvaluacion!=="MANUAL"){
   const raw=window.prompt(`Captura criterios técnicos como JSON. Códigos: ${rubric.map((r:any)=>r.codigo).join(", ")}`);
   if(raw===null)return;
   try{const criterios=JSON.parse(raw); evaluate.mutate({id:p.id,criteriosTecnicos:criterios,estadoEvaluacion:"ADMISIBLE",motivo:"Evaluación técnica por rúbrica"})}catch{window.alert("JSON de criterios inválido.")}
 }else{const raw=window.prompt("Puntaje técnico 0-100"); const score=raw===null?null:Number(raw); if(score!==null&&Number.isFinite(score)) evaluate.mutate({id:p.id,puntajeTecnico:score,estadoEvaluacion:"ADMISIBLE",motivo:"Evaluación técnica manual"})}
}}>Evaluar</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {lic.estado === "EN_EVALUACION" && (() => { const winner=(lic.participaciones||[]).filter((p:any)=>p.estadoEvaluacion==="ADMISIBLE").sort((a:any,b:any)=>Number(b.puntajeTotal||0)-Number(a.puntajeTotal||0))[0]; return winner ? <Card className="border-slate-700 bg-slate-800/50"><CardContent className="p-4 flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-slate-400">Primer lugar calculado por puntaje total</p><p className="text-white font-semibold">{winner.proveedor?.razonSocial} · {winner.puntajeTotal}</p><p className="text-xs text-slate-500">Monto ofertado: {formatCurrency(winner.montoOferta)}</p></div><Button className="bg-purple-700" onClick={()=>{const motivo=window.prompt("Motivo de adjudicación"); if(!motivo)return; adjudicate.mutate({id:lic.id,proveedorGanadorId:winner.proveedorId,montoAdjudicado:String(winner.montoOferta),motivo});}} disabled={adjudicate.isPending}>Adjudicar</Button></CardContent></Card> : null; })()}
    </div>
  );
}
