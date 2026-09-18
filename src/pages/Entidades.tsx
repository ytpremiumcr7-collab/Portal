import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, MapPin, Mail } from "lucide-react";

export default function Entidades() {
  const [page,setPage] = useState(1);
  const { data: entidadesPage, isLoading } = trpc.entidades.list.useQuery({page,pageSize:20});

  const getTipoBadge = (tipo: string) => {
    const v: Record<string, string> = {
      FEDERAL: "bg-blue-600",
      ESTATAL: "bg-cyan-600",
      MUNICIPAL: "bg-teal-600",
      ORGANISMO_AUTONOMO: "bg-purple-600",
      EMPRESA_PUBLICA: "bg-amber-600",
    };
    return v[tipo] || "bg-slate-600";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Building2 className="w-6 h-6 text-amber-500" />
        <h2 className="text-2xl font-bold text-white">Entidades Contratantes</h2>
      </div>

      {isLoading ? (
        <p className="text-slate-400 text-center py-8">Cargando...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {entidadesPage?.items.map((e: any) => (
            <Card key={e.id} className="border-slate-700 bg-slate-800/50">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-base font-semibold text-white">{e.razonSocial}</h3>
                  <Badge className={`text-xs ${getTipoBadge(e.tipoEntidad)}`}>
                    {e.tipoEntidad.replace(/_/g, " ")}
                  </Badge>
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2 text-slate-400">
                    <MapPin className="w-3 h-3" />
                    <span>{e.ciudad}, {e.estado}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-400">
                    <Mail className="w-3 h-3" />
                    <span>{e.email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-400">
                    <span className="text-slate-500">RFC:</span>
                    <span>{e.rfc}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2"><button className="px-3 py-2 border border-slate-600 rounded" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Anterior</button><span className="self-center text-sm text-slate-400">Página {page} de {entidadesPage?.pageCount??1}</span><button className="px-3 py-2 border border-slate-600 rounded" disabled={!entidadesPage||page>=entidadesPage.pageCount} onClick={()=>setPage(p=>p+1)}>Siguiente</button></div>
    </div>
  );
}
