import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";
import { EmptyState } from "@/components/ares/EmptyState";
import { FileText, Plus, Search, Eye, Trash2, CheckCircle } from "lucide-react";
import { Link } from "react-router";

type LicEstado =
  | "BORRADOR"
  | "CONSULTAS"
  | "PUBLICADA"
  | "EN_EVALUACION"
  | "ADJUDICADA"
  | "DESIERTA"
  | "CANCELADA"
  | "FINALIZADA"
  | "ARCHIVADA";

const estados: Array<{ value: LicEstado | "ALL"; label: string }> = [
  { value: "ALL", label: "Todos los estados" },
  { value: "BORRADOR", label: "Borrador" },
  { value: "PUBLICADA", label: "Publicada" },
  { value: "EN_EVALUACION", label: "En evaluación" },
  { value: "ADJUDICADA", label: "Adjudicada" },
  { value: "FINALIZADA", label: "Finalizada" },
  { value: "CANCELADA", label: "Cancelada" },
];

export default function Licitaciones() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [estado, setEstado] = useState<LicEstado | "ALL">("ALL");
  const utils = trpc.useUtils();

  const { data: licitacionesPage, isLoading } = trpc.licitaciones.list.useQuery(
    estado !== "ALL"
      ? { estado, search: search || undefined, page, pageSize: 25 }
      : { search: search || undefined, page, pageSize: 25 },
  );

  const deleteMutation = trpc.licitaciones.delete.useMutation({
    onSuccess: () => utils.licitaciones.list.invalidate(),
  });

  const publicarMutation = trpc.licitaciones.publicar.useMutation({
    onSuccess: () => utils.licitaciones.list.invalidate(),
  });

  const formatCurrency = (value: string) =>
    new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(parseFloat(value));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Licitaciones"
        description="Catálogo de procedimientos de contratación. Gestione el ciclo desde borrador hasta fallo y adjudicación."
        breadcrumbs={[
          { label: "Procedimiento", href: "/licitaciones" },
          { label: "Licitaciones" },
        ]}
        actions={
          <Link to="/licitaciones/nueva">
            <Button className="ares-cta">
              <Plus className="mr-2 h-4 w-4" />
              Nueva licitación
            </Button>
          </Link>
        }
      />

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="relative min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="lic-search" className="ares-label">
              Buscar
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                id="lic-search"
                placeholder="Buscar por título o código…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="ares-input pl-10"
              />
            </div>
          </div>
          <div className="w-full space-y-1.5 sm:w-52">
            <Label className="ares-label">Estado</Label>
            <Select
              value={estado}
              onValueChange={(v) => {
                setEstado(v as LicEstado | "ALL");
                setPage(1);
              }}
            >
              <SelectTrigger className="ares-input">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent className="border-slate-200 bg-white">
                {estados.map((e) => (
                  <SelectItem key={e.value} value={e.value} className="text-slate-200">
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 px-4 py-3 sm:px-5">
          <CardTitle className="text-sm font-semibold text-slate-900">
            {licitacionesPage?.items.length ?? 0} procedimiento
            {(licitacionesPage?.items.length ?? 0) === 1 ? "" : "s"} en esta página
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400">Cargando procedimientos…</p>
          ) : !licitacionesPage?.items.length ? (
            <EmptyState
              title="No se encontraron licitaciones"
              description="Ajuste los filtros o registre un nuevo procedimiento de contratación."
              icon={<FileText className="h-5 w-5" />}
              action={
                <Link to="/licitaciones/nueva">
                  <Button size="sm" className="ares-cta">
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Nueva licitación
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="ares-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Título</th>
                    <th>Entidad</th>
                    <th>Estado</th>
                    <th className="text-right">Monto</th>
                    <th className="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {licitacionesPage.items.map((lic: any) => (
                    <tr key={lic.id}>
                      <td className="font-mono text-xs text-slate-400">{lic.codigo}</td>
                      <td className="max-w-xs truncate font-medium text-slate-900">{lic.titulo}</td>
                      <td className="max-w-[12rem] truncate text-slate-400">
                        {lic.entidad?.razonSocial}
                      </td>
                      <td>
                        <StatusBadge status={lic.estado} />
                      </td>
                      <td className="text-right tabular-nums text-slate-200">
                        {formatCurrency(lic.montoPresupuestado)}
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <Link to={`/licitaciones/${lic.id}`}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-400 hover:text-slate-900"
                              title="Ver expediente"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          {lic.estado === "BORRADOR" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-emerald-400 hover:text-emerald-300"
                              title="Publicar"
                              onClick={() => {
                                const motivo = window.prompt("Motivo de publicación (obligatorio)");
                                if (motivo) publicarMutation.mutate({ id: lic.id, motivo });
                              }}
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-400 hover:text-red-300"
                            title="Eliminar"
                            onClick={() => {
                              if (
                                window.confirm(
                                  "¿Confirma eliminar esta licitación? Esta acción queda registrada en bitácora.",
                                )
                              ) {
                                deleteMutation.mutate({
                                  id: lic.id,
                                  motivo: "Borrado desde la administración",
                                });
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
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

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          className="border-slate-600 text-slate-700"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </Button>
        <span className="text-xs text-slate-500">
          Página {page} de {licitacionesPage?.pageCount ?? 1}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="border-slate-600 text-slate-700"
          disabled={!licitacionesPage || page >= licitacionesPage.pageCount}
          onClick={() => setPage((p) => p + 1)}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}
