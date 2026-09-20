import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";
import { EmptyState } from "@/components/ares/EmptyState";
import { MessagesSquare } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCapability } from "@/hooks/useCapability";

export default function DialogoCompetitivo() {
  useAuth({ redirectOnUnauthenticated: true });
  const { allowed: canPublicar } = useCapability("publicar");
  const [page, setPage] = useState(1);
  const [licitacionId, setLicitacionId] = useState("");
  const [tema, setTema] = useState("");
  const [motivoAbrir, setMotivoAbrir] = useState("");
  const [motivoCerrar, setMotivoCerrar] = useState<Record<number, string>>({});
  const [notaDraft, setNotaDraft] = useState<Record<number, string>>({});
  const [motivoNota, setMotivoNota] = useState<Record<number, string>>({});

  const list = trpc.dialogo.listRondas.useQuery({
    page,
    pageSize: 20,
    licitacionId: licitacionId ? Number(licitacionId) : undefined,
  });
  const abrir = trpc.dialogo.abrirRonda.useMutation({ onSuccess: () => { list.refetch(); setTema(""); setMotivoAbrir(""); } });
  const cerrar = trpc.dialogo.cerrarRonda.useMutation({ onSuccess: () => list.refetch() });
  const registrarNota = trpc.dialogo.registrarNota.useMutation({ onSuccess: () => list.refetch() });

  const capTitle = !canPublicar ? "Sin capacidad «publicar» / asignación de procedimiento" : undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Diálogo competitivo"
        description="Rondas de diálogo (modalidad IV). Abrir/cerrar exige motivo explícito; sólo DIALOGO_COMPETITIVO. LP clásica sigue rechazada sin Comité."
        breadcrumbs={[
          { label: "Procedimientos", href: "/licitaciones" },
          { label: "Diálogo competitivo" },
        ]}
      />

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 px-4 py-3 sm:px-5">
          <CardTitle className="text-sm font-semibold text-slate-900">Abrir ronda</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="ares-label ares-required">Licitación (ID)</Label>
            <Input
              value={licitacionId}
              onChange={(e) => setLicitacionId(e.target.value)}
              className="ares-input"
              placeholder="ID procedimiento"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="ares-label ares-required">Tema</Label>
            <Input value={tema} onChange={(e) => setTema(e.target.value)} className="ares-input" />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <Label className="ares-label ares-required">Motivo de apertura</Label>
            <Textarea
              value={motivoAbrir}
              onChange={(e) => setMotivoAbrir(e.target.value)}
              className="min-h-[72px] border-slate-600 bg-slate-800/80 text-slate-900"
              placeholder="Motivo jurídico (obligatorio, sin auto-relleno)"
            />
          </div>
          <div className="flex items-end">
            <Button
              className="ares-cta w-full"
              title={capTitle}
              disabled={
                !canPublicar ||
                !licitacionId ||
                tema.trim().length < 3 ||
                motivoAbrir.trim().length < 3 ||
                abrir.isPending
              }
              onClick={() =>
                abrir.mutate({
                  licitacionId: Number(licitacionId),
                  tema: tema.trim(),
                  motivo: motivoAbrir.trim(),
                })
              }
            >
              Abrir ronda
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 px-4 py-3 sm:px-5">
          <CardTitle className="text-sm font-semibold text-slate-900">Rondas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(list.data?.items ?? []).length === 0 ? (
            <EmptyState
              title="Sin rondas"
              description="Abra una ronda sobre un procedimiento en modalidad Diálogo competitivo (con autorizacionComiteRef)."
              icon={<MessagesSquare className="h-5 w-5" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="ares-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Lic.</th>
                    <th>#</th>
                    <th>Tema</th>
                    <th>Estado</th>
                    <th className="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {(list.data?.items ?? []).map((row: any) => (
                    <tr key={row.id}>
                      <td className="tabular-nums text-slate-400">{row.id}</td>
                      <td className="tabular-nums text-slate-700">{row.licitacionId}</td>
                      <td className="tabular-nums text-slate-200">{row.ronda}</td>
                      <td className="max-w-[14rem] truncate text-slate-200" title={row.tema}>
                        {row.tema}
                      </td>
                      <td>
                        <StatusBadge status={row.estado} />
                      </td>
                      <td className="space-y-2 text-right">
                        {row.estado === "ABIERTA" && (
                          <div className="flex flex-col items-end gap-2">
                            <div className="flex w-full max-w-md flex-col gap-1">
                              <Input
                                placeholder="Motivo de cierre (obligatorio)"
                                value={motivoCerrar[row.id] ?? ""}
                                onChange={(e) =>
                                  setMotivoCerrar((m) => ({ ...m, [row.id]: e.target.value }))
                                }
                                className="ares-input h-8 text-xs"
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 border-slate-600 text-xs text-slate-700"
                                title={capTitle}
                                disabled={
                                  !canPublicar ||
                                  !(motivoCerrar[row.id] ?? "").trim() ||
                                  cerrar.isPending
                                }
                                onClick={() =>
                                  cerrar.mutate({
                                    id: row.id,
                                    motivo: (motivoCerrar[row.id] ?? "").trim(),
                                  })
                                }
                              >
                                Cerrar ronda
                              </Button>
                            </div>
                            <div className="flex w-full max-w-md flex-col gap-1">
                              <Textarea
                                placeholder="Nota de diálogo / negociación"
                                value={notaDraft[row.id] ?? ""}
                                onChange={(e) =>
                                  setNotaDraft((n) => ({ ...n, [row.id]: e.target.value }))
                                }
                                className="min-h-[56px] border-slate-600 bg-slate-800/80 text-xs text-slate-900"
                              />
                              <Input
                                placeholder="Motivo del registro de nota"
                                value={motivoNota[row.id] ?? ""}
                                onChange={(e) =>
                                  setMotivoNota((m) => ({ ...m, [row.id]: e.target.value }))
                                }
                                className="ares-input h-8 text-xs"
                              />
                              <Button
                                size="sm"
                                className="ares-cta h-7 text-xs"
                                title={capTitle}
                                disabled={
                                  !canPublicar ||
                                  (notaDraft[row.id] ?? "").trim().length < 5 ||
                                  (motivoNota[row.id] ?? "").trim().length < 3 ||
                                  registrarNota.isPending
                                }
                                onClick={() =>
                                  registrarNota.mutate({
                                    id: row.id,
                                    nota: (notaDraft[row.id] ?? "").trim(),
                                    motivo: (motivoNota[row.id] ?? "").trim(),
                                  })
                                }
                              >
                                Registrar nota
                              </Button>
                            </div>
                          </div>
                        )}
                        {row.estado === "CERRADA" && (
                          <span className="text-xs text-slate-500">Cerrada</span>
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
          className="border-slate-600 text-slate-700"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="border-slate-600 text-slate-700"
          disabled={!list.data || page >= (list.data.pageCount ?? 1)}
          onClick={() => setPage((p) => p + 1)}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}
