import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Users, Search, Star } from "lucide-react";

export default function Proveedores() {
  const [page,setPage] = useState(1);
  const [search, setSearch] = useState("");
  const { data: proveedoresPage, isLoading } = trpc.proveedores.list.useQuery(
    search ? { search, page, pageSize: 20 } : { page, pageSize: 20 }
  );

  const getEstadoBadge = (estado: string) => {
    const v: Record<string, string> = {
      PENDIENTE: "bg-amber-600",
      VERIFICADO: "bg-emerald-600",
      RECHAZADO: "bg-red-600",
      SUSPENDIDO: "bg-red-800",
    };
    return v[estado] || "bg-slate-600";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-amber-500" />
          <h2 className="text-2xl font-bold text-white">Proveedores</h2>
        </div>
      </div>

      <Card className="border-slate-700 bg-slate-800/50">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              placeholder="Buscar por nombre o rubro..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-slate-700 border-slate-600 text-white"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading ? (
          <p className="text-slate-400 col-span-2 text-center py-8">Cargando...</p>
        ) : proveedoresPage?.items.length === 0 ? (
          <p className="text-slate-500 col-span-2 text-center py-8">No se encontraron proveedores</p>
        ) : (
          proveedoresPage?.items.map((p: any) => (
            <Card key={p.id} className="border-slate-700 bg-slate-800/50 hover:bg-slate-800 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="text-base font-semibold text-white">{p.razonSocial}</h3>
                    <p className="text-xs text-slate-400">{p.nombreFantasia}</p>
                  </div>
                  <Badge className={`text-xs ${getEstadoBadge(p.estadoVerificacion)}`}>
                    {p.estadoVerificacion}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                  <div><span className="text-slate-500">RFC:</span> <span className="text-slate-300">{p.rfc}</span></div>
                  <div><span className="text-slate-500">Tipo:</span> <span className="text-slate-300">{p.tipoProveedor.replace(/_/g, " ")}</span></div>
                  <div><span className="text-slate-500">Rubro:</span> <span className="text-slate-300">{p.rubroPrincipal}</span></div>
                  <div><span className="text-slate-500">Ciudad:</span> <span className="text-slate-300">{p.ciudad}</span></div>
                </div>
                <div className="flex items-center gap-1 text-amber-500">
                  <Star className="w-3 h-3 fill-current" />
                  <span className="text-xs font-medium">{p.calificacionHistorica}</span>
                  <span className="text-slate-500 ml-2">{p.licitacionesGanadas}/{p.licitacionesParticipadas} ganadas</span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      <div className="flex justify-end gap-2"><button className="px-3 py-2 border border-slate-600 rounded" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Anterior</button><span className="self-center text-sm text-slate-400">Página {page} de {proveedoresPage?.pageCount??1}</span><button className="px-3 py-2 border border-slate-600 rounded" disabled={!proveedoresPage||page>=proveedoresPage.pageCount} onClick={()=>setPage(p=>p+1)}>Siguiente</button></div>
    </div>
  );
}
