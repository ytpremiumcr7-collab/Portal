import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";
import { EmptyState } from "@/components/ares/EmptyState";
import { Banknote } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCapability } from "@/hooks/useCapability";

export default function Pagos() {
  useAuth({ redirectOnUnauthenticated: true });
  const { allowed: canPresentar } = useCapability("presentar_pago");
  const { allowed: canAprobar } = useCapability("aprobar_pago");
  const [page, setPage] = useState(1);
  const [contratoId, setContratoId] = useState("");
  const [folio, setFolio] = useState("");
  const [numero, setNumero] = useState("1");
  const [monto, setMonto] = useState("");
  const list = trpc.pagos.list.useQuery({ page, pageSize: 20 });
  const presentar = trpc.pagos.presentar.useMutation({ onSuccess: () => list.refetch() });
  const revisar = trpc.pagos.revisar.useMutation({ onSuccess: () => list.refetch() });
  const autorizar = trpc.pagos.autorizar.useMutation({ onSuccess: () => list.refetch() });
  const pagar = trpc.pagos.pagar.useMutation({ onSuccess: () => list.refetch() });
  const rechazar = trpc.pagos.rechazar.useMutation({ onSuccess: () => list.refetch() });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pagos y estimaciones"
        description="Flujo de estimaciones con segregación de funciones: presentar ≠ autorizar. PRESENTADA → EN_REVISION → AUTORIZADA → PAGADA."
        breadcrumbs={[
          { label: "Contratación", href: "/contratos" },
          { label: "Pagos" },
        ]}
      />

      <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
        <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
          <CardTitle className="text-sm font-semibold text-slate-100">Presentar estimación</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3 p-4 sm:px-5">
          <div className="space-y-1.5">
            <Label className="ares-label ares-required">Contrato (ID)</Label>
            <Input
              value={contratoId}
              onChange={(e) => setContratoId(e.target.value)}
              className="ares-input max-w-[8rem]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="ares-label ares-required">Folio</Label>
            <Input value={folio} onChange={(e) => setFolio(e.target.value)} className="ares-input max-w-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="ares-label">Número</Label>
            <Input
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              className="ares-input max-w-[6rem]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="ares-label ares-required">Monto bruto</Label>
            <Input value={monto} onChange={(e) => setMonto(e.target.value)} className="ares-input max-w-[10rem]" />
          </div>
          <Button
            className="ares-cta"
            disabled={!canPresentar || !contratoId || !folio || !monto || presentar.isPending}
            onClick={() =>
              presentar.mutate({
                contratoId: Number(contratoId),
                folio,
                numero: Number(numero),
                montoBruto: monto,
                retencion: "0.00",
                motivo: "Presentación de estimación",
              })
            }
          >
            Presentar
          </Button>
        </CardContent>
      </Card>

      <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
        <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
          <CardTitle className="text-sm font-semibold text-slate-100">Estimaciones</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(list.data?.items ?? []).length === 0 ? (
            <EmptyState
              title="Sin estimaciones"
              description="Presente una estimación vinculada a un contrato vigente para iniciar el flujo de pago."
              icon={<Banknote className="h-5 w-5" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="ares-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Folio</th>
                    <th>Neto</th>
                    <th>Estado</th>
                    <th className="text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {(list.data?.items ?? []).map((row: any) => (
                    <tr key={row.id}>
                      <td className="tabular-nums text-slate-400">{row.id}</td>
                      <td className="font-medium text-slate-200">{row.folio}</td>
                      <td className="tabular-nums text-slate-300">${row.montoNeto}</td>
                      <td>
                        <StatusBadge status={row.estado} />
                      </td>
                      <td className="space-x-2 text-right">
                        {row.estado === "PRESENTADA" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 border-slate-600 text-xs text-slate-300"
                            disabled={!canAprobar} onClick={() => revisar.mutate({ id: row.id, motivo: "Pasar a revisión" })}
                          >
                            Revisar
                          </Button>
                        )}
                        {row.estado === "EN_REVISION" && (
                          <>
                            <Button
                              size="sm"
                              className="ares-cta h-7 text-xs"
                              onClick={() => {
                                if (!window.confirm("¿Confirma autorizar este pago?")) return;
                                autorizar.mutate({ id: row.id, motivo: "Autorizar pago" });
                              }}
                            >
                              Autorizar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 border-red-900/50 text-xs text-red-300"
                              onClick={() => {
                                if (!window.confirm("¿Confirma rechazar esta estimación?")) return;
                                rechazar.mutate({
                                  id: row.id,
                                  motivoRechazo: "No procede la estimación presentada",
                                  motivo: "Rechazo",
                                });
                              }}
                            >
                              Rechazar
                            </Button>
                          </>
                        )}
                        {row.estado === "AUTORIZADA" && (
                          <Button
                            size="sm"
                            className="ares-cta h-7 text-xs"
                            onClick={() => {
                              if (!window.confirm("¿Confirma registrar el pago ejecutado?")) return;
                              pagar.mutate({ id: row.id, motivo: "Registrar pago" });
                            }}
                          >
                            Registrar pago
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
