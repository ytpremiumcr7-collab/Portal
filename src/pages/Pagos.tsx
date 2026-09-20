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

function CapButton({
  allowed,
  missingLabel,
  disabledExtra,
  children,
  ...rest
}: React.ComponentProps<typeof Button> & {
  allowed: boolean;
  missingLabel: string;
  disabledExtra?: boolean;
}) {
  const blocked = !allowed;
  return (
    <Button
      {...rest}
      disabled={blocked || !!disabledExtra || rest.disabled}
      title={blocked ? missingLabel : rest.title}
    >
      {children}
    </Button>
  );
}

export default function Pagos() {
  useAuth({ redirectOnUnauthenticated: true });
  const { allowed: canPresentar } = useCapability("presentar_pago");
  const { allowed: canAprobar } = useCapability("aprobar_pago");
  const [page, setPage] = useState(1);
  const [contratoId, setContratoId] = useState("");
  const [folio, setFolio] = useState("");
  const [numero, setNumero] = useState("1");
  const [monto, setMonto] = useState("");
  const [motivoPresentar, setMotivoPresentar] = useState("");
  const list = trpc.pagos.list.useQuery({ page, pageSize: 20 });
  const presentar = trpc.pagos.presentar.useMutation({ onSuccess: () => list.refetch() });
  const revisar = trpc.pagos.revisar.useMutation({ onSuccess: () => list.refetch() });
  const autorizar = trpc.pagos.autorizar.useMutation({ onSuccess: () => list.refetch() });
  const pagar = trpc.pagos.pagar.useMutation({ onSuccess: () => list.refetch() });
  const rechazar = trpc.pagos.rechazar.useMutation({ onSuccess: () => list.refetch() });

  const noPresentar = "Sin capacidad «presentar_pago» / asignación de procedimiento";
  const noAprobar = "Sin capacidad «aprobar_pago» / asignación de procedimiento";

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
          <div className="space-y-1.5">
            <Label className="ares-label ares-required">Motivo</Label>
            <Input
              value={motivoPresentar}
              onChange={(e) => setMotivoPresentar(e.target.value)}
              className="ares-input max-w-xs"
              placeholder="Motivo (obligatorio)"
            />
          </div>
          <CapButton
            className="ares-cta"
            allowed={canPresentar}
            missingLabel={noPresentar}
            disabledExtra={!contratoId || !folio || !monto || motivoPresentar.trim().length < 3 || presentar.isPending}
            onClick={() =>
              presentar.mutate({
                contratoId: Number(contratoId),
                folio,
                numero: Number(numero),
                montoBruto: monto,
                retencion: "0.00",
                motivo: motivoPresentar.trim(),
              })
            }
          >
            Presentar
          </CapButton>
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
                          <CapButton
                            size="sm"
                            variant="outline"
                            className="h-7 border-slate-600 text-xs text-slate-300"
                            allowed={canAprobar}
                            missingLabel={noAprobar}
                            disabledExtra={revisar.isPending}
                            onClick={() => {
                              const motivo = window.prompt("Motivo para pasar a revisión:");
                              if (!motivo || motivo.trim().length < 3) return;
                              revisar.mutate({ id: row.id, motivo: motivo.trim() });
                            }}
                          >
                            Revisar
                          </CapButton>
                        )}
                        {row.estado === "EN_REVISION" && (
                          <>
                            <CapButton
                              size="sm"
                              className="ares-cta h-7 text-xs"
                              allowed={canAprobar}
                              missingLabel={noAprobar}
                              disabledExtra={autorizar.isPending}
                              onClick={() => {
                                const motivo = window.prompt("Motivo de autorización:");
                                if (!motivo || motivo.trim().length < 3) return;
                                if (!window.confirm("¿Confirma autorizar este pago?")) return;
                                autorizar.mutate({ id: row.id, motivo: motivo.trim() });
                              }}
                            >
                              Autorizar
                            </CapButton>
                            <CapButton
                              size="sm"
                              variant="outline"
                              className="h-7 border-red-900/50 text-xs text-red-300"
                              allowed={canAprobar}
                              missingLabel={noAprobar}
                              disabledExtra={rechazar.isPending}
                              onClick={() => {
                                const motivoRechazo = window.prompt("Motivo de rechazo (mín. 5 caracteres):");
                                if (!motivoRechazo || motivoRechazo.trim().length < 5) return;
                                const motivo = window.prompt("Motivo de auditoría:");
                                if (!motivo || motivo.trim().length < 3) return;
                                if (!window.confirm("¿Confirma rechazar esta estimación?")) return;
                                rechazar.mutate({
                                  id: row.id,
                                  motivoRechazo: motivoRechazo.trim(),
                                  motivo: motivo.trim(),
                                });
                              }}
                            >
                              Rechazar
                            </CapButton>
                          </>
                        )}
                        {row.estado === "AUTORIZADA" && (
                          <CapButton
                            size="sm"
                            className="ares-cta h-7 text-xs"
                            allowed={canAprobar}
                            missingLabel={noAprobar}
                            disabledExtra={pagar.isPending}
                            onClick={() => {
                              const motivo = window.prompt("Motivo de registro de pago:");
                              if (!motivo || motivo.trim().length < 3) return;
                              if (!window.confirm("¿Confirma registrar el pago ejecutado?")) return;
                              pagar.mutate({ id: row.id, motivo: motivo.trim() });
                            }}
                          >
                            Registrar pago
                          </CapButton>
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
