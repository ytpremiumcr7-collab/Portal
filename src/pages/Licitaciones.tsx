import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FileText, Plus, Search, Eye, Trash2, CheckCircle,
} from "lucide-react";
import { Link } from "react-router";

type LicEstado = "BORRADOR" | "CONSULTAS" | "PUBLICADA" | "EN_EVALUACION" | "ADJUDICADA" | "DESIERTA" | "CANCELADA" | "FINALIZADA" | "ARCHIVADA";

const estados: Array<{ value: LicEstado | ""; label: string }> = [
  { value: "", label: "Todos" },
  { value: "BORRADOR", label: "Borrador" },
  { value: "PUBLICADA", label: "Publicada" },
  { value: "EN_EVALUACION", label: "En Evaluacion" },
  { value: "ADJUDICADA", label: "Adjudicada" },
  { value: "FINALIZADA", label: "Finalizada" },
  { value: "CANCELADA", label: "Cancelada" },
];

export default function Licitaciones() {
  const [page,setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [estado, setEstado] = useState<LicEstado | "">("");
  const utils = trpc.useUtils();

  const { data: licitacionesPage, isLoading } = trpc.licitaciones.list.useQuery(
    estado ? { estado, search: search || undefined, page, pageSize: 25 } : { search: search || undefined, page, pageSize: 25 }
  );

  const deleteMutation = trpc.licitaciones.delete.useMutation({
    onSuccess: () => utils.licitaciones.list.invalidate(),
  });

  const publicarMutation = trpc.licitaciones.publicar.useMutation({
    onSuccess: () => utils.licitaciones.list.invalidate(),
  });

  const formatCurrency = (value: string) => {
    return new Intl.NumberFormat("es-MX", {
      style: "currency", currency: "MXN", minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(parseFloat(value));
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-amber-500" />
          <h2 className="text-2xl font-bold text-white">Licitaciones</h2>
        </div>
        <Link to="/licitaciones/nueva">
          <Button className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700">
            <Plus className="w-4 h-4 mr-2" /> Nueva Licitacion
          </Button>
        </Link>
      </div>

      <Card className="border-slate-700 bg-slate-800/50">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input
                placeholder="Buscar por titulo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-slate-700 border-slate-600 text-white"
              />
            </div>
            <Select value={estado} onValueChange={(v) => setEstado(v as LicEstado | "")}>
              <SelectTrigger className="w-full sm:w-48 bg-slate-700 border-slate-600 text-white">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent className="bg-slate-700 border-slate-600">
                {estados.map((e) => (
                  <SelectItem key={e.value} value={e.value} className="text-white hover:bg-slate-600">{e.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader>
          <CardTitle className="text-white text-base">
            {licitacionesPage?.items.length || 0} licitaciones encontradas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-slate-400 text-center py-8">Cargando...</p>
          ) : licitacionesPage?.items.length === 0 ? (
            <p className="text-slate-500 text-center py-8">No se encontraron licitaciones</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Codigo</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Titulo</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Entidad</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Estado</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Monto</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {licitacionesPage?.items.map((lic: any) => (
                    <tr key={lic.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="py-3 px-4 text-sm font-mono text-amber-500">{lic.codigo}</td>
                      <td className="py-3 px-4 text-sm text-white">{lic.titulo}</td>
                      <td className="py-3 px-4 text-sm text-slate-300">{lic.entidad?.razonSocial}</td>
                      <td className="py-3 px-4">
                        <Badge className={`text-xs ${getEstadoBadge(lic.estado)}`}>
                          {lic.estado.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-sm text-white text-right">{formatCurrency(lic.montoPresupuestado)}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link to={`/licitaciones/${lic.id}`}>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-white">
                              <Eye className="w-4 h-4" />
                            </Button>
                          </Link>
                          {lic.estado === "BORRADOR" && (
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8 text-emerald-400 hover:text-emerald-300"
                              onClick={() => { const motivo = window.prompt("Motivo de publicación"); if (motivo) publicarMutation.mutate({ id: lic.id, motivo }); }}
                              title="Publicar"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-300"
                            onClick={() => { if (confirm("Eliminar esta licitacion?")) deleteMutation.mutate({ id: lic.id, motivo: "Borrado desde la administración" }); }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Anterior</Button><span className="self-center text-sm text-slate-400">Página {page} de {licitacionesPage?.pageCount??1}</span><Button variant="outline" disabled={!licitacionesPage||page>=licitacionesPage.pageCount} onClick={()=>setPage(p=>p+1)}>Siguiente</Button></div>
    </div>
  );
}
