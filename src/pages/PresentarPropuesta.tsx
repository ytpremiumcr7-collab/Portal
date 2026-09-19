import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import PageHeader from "@/components/ares/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ares/StatusBadge";

/**
 * Presentar propuesta: docs + acuse. No reveals other bidders' prices.
 */
export default function PresentarPropuesta() {
  const [params] = useSearchParams();
  const licitacionIdParam = Number(params.get("licitacionId") || 0) || undefined;
  const [licitacionId, setLicitacionId] = useState(licitacionIdParam ? String(licitacionIdParam) : "");
  const [monto, setMonto] = useState("");
  const [plazo, setPlazo] = useState("30");
  const [obs, setObs] = useState("");
  const [acuse, setAcuse] = useState<any>(null);

  const detalle = trpc.licitaciones.getById.useQuery(
    { id: Number(licitacionId) },
    { enabled: Number(licitacionId) > 0 },
  );
  const crear = trpc.participaciones.create.useMutation({
    onSuccess: (row) => setAcuse(row),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Presentar propuesta"
        description="Capture el sobre económico y registre la proposición. Los montos de otros licitantes no son visibles antes de la apertura."
        breadcrumbs={[{ label: "Área proveedor" }, { label: "Presentar propuesta" }]}
      />

      <div className="ares-panel space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">ID del procedimiento</Label>
            <Input value={licitacionId} onChange={(e) => setLicitacionId(e.target.value)} placeholder="Ej. 12" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Estado del procedimiento</Label>
            <div className="flex h-9 items-center">
              {detalle.data ? <StatusBadge status={detalle.data.estado} /> : <span className="text-xs text-slate-400">—</span>}
            </div>
          </div>
        </div>
        {detalle.data && (
          <p className="text-sm text-slate-700">
            <span className="font-mono text-xs">{detalle.data.codigo}</span> — {detalle.data.titulo}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Monto de oferta (MXN)</Label>
            <Input value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="100000.00" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Plazo de ejecución (días)</Label>
            <Input value={plazo} onChange={(e) => setPlazo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Observaciones</Label>
            <Input value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!licitacionId || !monto || crear.isPending}
            onClick={() =>
              crear.mutate({
                licitacionId: Number(licitacionId),
                montoOferta: monto,
                plazoEjecucion: Number(plazo),
                observaciones: obs || undefined,
              })
            }
          >
            Registrar proposición
          </Button>
          <Button variant="outline" asChild>
            <Link to="/oportunidades">Volver a oportunidades</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/documentos">Adjuntar documentos</Link>
          </Button>
        </div>
        {crear.error && (
          <p className="text-sm text-red-700">{(crear.error as any)?.message ?? "Error al presentar"}</p>
        )}
        {acuse && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-semibold">Acuse de recepción</p>
            <p className="mt-1 font-mono text-xs">Participación #{acuse.id}</p>
            <p className="text-xs">Recibido: {acuse.recibidoAt ? new Date(acuse.recibidoAt).toLocaleString("es-MX") : "—"}</p>
            <p className="mt-2 text-xs text-emerald-800">
              Conserve este acuse. El sobre económico permanece sellado frente a la convocante hasta la apertura.
            </p>
            <Link className="mt-2 inline-block text-xs underline" to="/mis-proposiciones">Ver mis proposiciones</Link>
          </div>
        )}
      </div>
    </div>
  );
}
