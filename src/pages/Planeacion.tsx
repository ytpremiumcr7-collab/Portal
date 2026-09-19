import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";
import { EmptyState } from "@/components/ares/EmptyState";
import { ClipboardList } from "lucide-react";

export default function Planeacion() {
  const [page, setPage] = useState(1);
  const [folio, setFolio] = useState("");
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [justificacion, setJustificacion] = useState("");
  const [entidadId, setEntidadId] = useState("");
  const [monto, setMonto] = useState("");
  const [necId, setNecId] = useState("");
  const [to, setTo] = useState("EN_REVISION");
  const list = trpc.planeacion.listNecesidades.useQuery({ page, pageSize: 20 });
  const crear = trpc.planeacion.crearNecesidad.useMutation({ onSuccess: () => list.refetch() });
  const trans = trpc.planeacion.transicionarNecesidad.useMutation({ onSuccess: () => list.refetch() });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Planeación"
        description="Registro y autorización de necesidades de contratación previo al procedimiento."
        breadcrumbs={[
          { label: "Planeación", href: "/planeacion" },
          { label: "Necesidades" },
        ]}
      />

      <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
        <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
          <CardTitle className="text-sm font-semibold text-slate-100">Nueva necesidad</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 sm:px-5">
          <div className="space-y-1.5">
            <Label className="ares-label ares-required">Entidad (ID)</Label>
            <Input value={entidadId} onChange={(e) => setEntidadId(e.target.value)} className="ares-input" />
            <p className="ares-help">Identificador de la entidad contratante.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="ares-label ares-required">Folio</Label>
            <Input value={folio} onChange={(e) => setFolio(e.target.value)} className="ares-input" />
          </div>
          <div className="space-y-1.5">
            <Label className="ares-label ares-required">Título</Label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} className="ares-input" />
          </div>
          <div className="space-y-1.5">
            <Label className="ares-label ares-required">Monto estimado</Label>
            <Input value={monto} onChange={(e) => setMonto(e.target.value)} className="ares-input" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="ares-label">Descripción</Label>
            <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="ares-input" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="ares-label">Justificación</Label>
            <Input value={justificacion} onChange={(e) => setJustificacion(e.target.value)} className="ares-input" />
          </div>
          <div className="flex items-end">
            <Button
              className="ares-cta"
              disabled={crear.isPending || !folio || !titulo || !entidadId || !monto}
              onClick={() =>
                crear.mutate({
                  entidadId: Number(entidadId),
                  folio,
                  titulo,
                  descripcion: descripcion || "Necesidad operativa registrada",
                  justificacion: justificacion || "Justificación de la necesidad operativa",
                  montoEstimado: monto,
                  tipoContratacion: "BIENES",
                  motivo: "Alta de necesidad",
                })
              }
            >
              Registrar necesidad
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
        <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
          <CardTitle className="text-sm font-semibold text-slate-100">Transicionar necesidad</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3 p-4 sm:px-5">
          <div className="space-y-1.5">
            <Label className="ares-label ares-required">ID necesidad</Label>
            <Input value={necId} onChange={(e) => setNecId(e.target.value)} className="ares-input max-w-[8rem]" />
          </div>
          <div className="space-y-1.5">
            <Label className="ares-label ares-required">Estado destino</Label>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="EN_REVISION | APROBADA | RECHAZADA"
              className="ares-input max-w-xs"
            />
            <p className="ares-help">Use EN_REVISION, APROBADA o RECHAZADA.</p>
          </div>
          <Button
            variant="outline"
            className="border-slate-600 text-slate-300"
            disabled={!necId || trans.isPending}
            onClick={() =>
              trans.mutate({ id: Number(necId), to: to as any, motivo: `Transición a ${to}` })
            }
          >
            Aplicar transición
          </Button>
        </CardContent>
      </Card>

      <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
        <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
          <CardTitle className="text-sm font-semibold text-slate-100">Necesidades registradas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(list.data?.items ?? []).length === 0 ? (
            <EmptyState
              title="Sin necesidades registradas"
              description="Registre la primera necesidad de contratación para iniciar el proceso de planeación."
              icon={<ClipboardList className="h-5 w-5" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="ares-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Folio / Título</th>
                    <th>Estado</th>
                    <th className="text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {(list.data?.items ?? []).map((row: any) => (
                    <tr key={row.id}>
                      <td className="tabular-nums text-slate-400">{row.id}</td>
                      <td className="text-slate-200">
                        <span className="font-mono text-xs text-slate-500">{row.folio}</span>
                        <span className="mx-1.5 text-slate-600">—</span>
                        {row.titulo}
                      </td>
                      <td>
                        <StatusBadge status={row.estado} />
                      </td>
                      <td className="space-x-2 text-right">
                        {row.estado === "BORRADOR" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 border-slate-600 text-xs text-slate-300"
                            onClick={() =>
                              trans.mutate({
                                id: row.id,
                                to: "EN_REVISION",
                                motivo: "Enviar a revisión",
                              })
                            }
                          >
                            Enviar a revisión
                          </Button>
                        )}
                        {row.estado === "EN_REVISION" && (
                          <Button
                            size="sm"
                            className="ares-cta h-7 text-xs"
                            onClick={() => {
                              if (
                                !window.confirm(
                                  "¿Confirma aprobar esta necesidad? Quedará disponible para vincular a un procedimiento.",
                                )
                              )
                                return;
                              trans.mutate({
                                id: row.id,
                                to: "APROBADA",
                                motivo: "Aprobar necesidad",
                              });
                            }}
                          >
                            Aprobar
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          className="border-slate-600 text-slate-300"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="border-slate-600 text-slate-300"
          disabled={!list.data || page >= (list.data.pageCount ?? 1)}
          onClick={() => setPage((p) => p + 1)}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}
