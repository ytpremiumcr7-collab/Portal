import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Shield, CheckCircle, XCircle, Search } from "lucide-react";

export default function Alertas() {
  const [page,setPage] = useState(1);
  const utils = trpc.useUtils();
  const { data: alertasPage, isLoading } = trpc.alertas.list.useQuery({page,pageSize:20});

  const updateMutation = trpc.alertas.updateEstado.useMutation({
    onSuccess: () => utils.alertas.list.invalidate(),
  });

  const getSeveridadBadge = (s: string) => {
    const v: Record<string, string> = {
      BAJA: "bg-blue-600 text-blue-100",
      MEDIA: "bg-amber-600 text-amber-100",
      ALTA: "bg-orange-600 text-orange-100",
      CRITICA: "bg-red-600 text-red-100",
    };
    return v[s] || "bg-slate-600";
  };

  const getEstadoBadge = (s: string) => {
    const v: Record<string, string> = {
      NUEVA: "bg-amber-500 text-amber-100",
      INVESTIGANDO: "bg-blue-500 text-blue-100",
      CONFIRMADA: "bg-red-500 text-red-100",
      DESCARTADA: "bg-slate-500 text-slate-100",
      RESUELTA: "bg-emerald-500 text-emerald-100",
    };
    return v[s] || "bg-slate-600";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-6 h-6 text-red-500" />
        <h2 className="text-2xl font-bold text-white">Alertas de Seguridad</h2>
      </div>

      {isLoading ? (
        <p className="text-slate-400 text-center py-8">Cargando...</p>
      ) : alertasPage?.items.length === 0 ? (
        <Card className="border-slate-700 bg-slate-800/50">
          <CardContent className="p-8 flex flex-col items-center gap-3">
            <Shield className="w-12 h-12 text-emerald-500" />
            <p className="text-emerald-400 font-medium">Sistema seguro - Sin alertas activas</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {alertasPage?.items.map((a: any) => (
            <Card key={a.id} className="border-slate-700 bg-slate-800/50">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={`text-xs ${getSeveridadBadge(a.severidad)}`}>{a.severidad}</Badge>
                    <Badge className={`text-xs ${getEstadoBadge(a.estado)}`}>{a.estado}</Badge>
                    <span className="text-xs font-mono text-slate-500">{a.codigo}</span>
                  </div>
                  <span className="text-xs text-slate-500">
                    {a.creadaEn ? new Date(a.creadaEn).toLocaleDateString("es-MX") : ""}
                  </span>
                </div>

                <p className="text-sm text-slate-300 mb-3">{a.descripcion}</p>

                <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
                  {a.licitacion && <span>Lic: {a.licitacion.titulo}</span>}
                  {a.proveedor && <span>Prov: {a.proveedor.razonSocial}</span>}
                </div>

                {(a.estado === "NUEVA" || a.estado === "INVESTIGANDO") && (
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm" variant="outline"
                      className="border-emerald-600 text-emerald-400 hover:bg-emerald-600/20"
                      onClick={() => updateMutation.mutate({ id: a.id, estado: "RESUELTA", motivo: "Resolución por usuario autorizado" })}
                    >
                      <CheckCircle className="w-3 h-3 mr-1" /> Resolver
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="border-slate-600 text-slate-400 hover:bg-slate-600/20"
                      onClick={() => updateMutation.mutate({ id: a.id, estado: "DESCARTADA", motivo: "Descartada por revisión humana" })}
                    >
                      <XCircle className="w-3 h-3 mr-1" /> Descartar
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="border-blue-600 text-blue-400 hover:bg-blue-600/20"
                      onClick={() => updateMutation.mutate({ id: a.id, estado: "INVESTIGANDO", motivo: "Inicio de investigación" })}
                    >
                      <Search className="w-3 h-3 mr-1" /> Investigar
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Anterior</Button><span className="self-center text-sm text-slate-400">Página {page} de {alertasPage?.pageCount??1}</span><Button variant="outline" disabled={!alertasPage||page>=alertasPage.pageCount} onClick={()=>setPage(p=>p+1)}>Siguiente</Button></div>
    </div>
  );
}
