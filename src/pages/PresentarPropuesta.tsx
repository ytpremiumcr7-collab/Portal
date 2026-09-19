import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import PageHeader from "@/components/ares/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ares/StatusBadge";

/**
 * Presentar propuesta: select docs + monto → one present call (atomic immutable proposition).
 */
export default function PresentarPropuesta() {
  const [params] = useSearchParams();
  const licitacionIdParam = Number(params.get("licitacionId") || 0) || undefined;
  const [licitacionId, setLicitacionId] = useState(licitacionIdParam ? String(licitacionIdParam) : "");
  const [monto, setMonto] = useState("");
  const [plazo, setPlazo] = useState("30");
  const [obs, setObs] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [acuse, setAcuse] = useState<any>(null);

  const licIdNum = Number(licitacionId) || 0;
  const detalle = trpc.licitaciones.getById.useQuery(
    { id: licIdNum },
    { enabled: licIdNum > 0 },
  );
  const docs = trpc.documentos.list.useQuery(
    { licitacionId: licIdNum, vigentes: true, pageSize: 100 },
    { enabled: licIdNum > 0 },
  );
  const crear = trpc.participaciones.create.useMutation({
    onSuccess: (row) => setAcuse(row),
  });

  const offerDocs = useMemo(
    () => (docs.data?.items ?? []).filter((d: any) =>
      ["OFERTA_TECNICA", "OFERTA_ECONOMICA", "GARANTIA", "OTRO"].includes(d.tipo)),
    [docs.data],
  );

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const canSubmit = licIdNum > 0 && !!monto && selected.length >= 2 && !crear.isPending;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Presentar propuesta"
        description="Seleccione los documentos del manifiesto y el monto. Un solo envío crea la proposición inmutable."
        breadcrumbs={[{ label: "Área proveedor" }, { label: "Presentar propuesta" }]}
      />

      <div className="ares-panel space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">ID del procedimiento</Label>
            <Input value={licitacionId} onChange={(e) => { setLicitacionId(e.target.value); setSelected([]); }} placeholder="Ej. 12" />
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

        <div className="space-y-2">
          <Label className="text-xs">Documentos del manifiesto (OFERTA_TECNICA + OFERTA_ECONOMICA requeridas)</Label>
          {licIdNum <= 0 ? (
            <p className="text-xs text-slate-500">Indique el ID del procedimiento para listar documentos.</p>
          ) : offerDocs.length === 0 ? (
            <p className="text-xs text-amber-700">
              No hay documentos vigentes.{" "}
              <Link className="underline" to={`/documentos?licitacionId=${licIdNum}`}>Cargar ofertas</Link>
            </p>
          ) : (
            <ul className="divide-y rounded-md border border-slate-200">
              {offerDocs.map((d: any) => (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(d.id)}
                    onChange={() => toggle(d.id)}
                    className="h-4 w-4"
                  />
                  <span className="font-mono text-xs text-slate-500">#{d.id}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide">{d.tipo}</span>
                  <span className="truncate text-slate-700">{d.nombreArchivo}</span>
                  <span className="ml-auto text-[10px] text-slate-400">{d.estado}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

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
            disabled={!canSubmit}
            onClick={() =>
              crear.mutate({
                licitacionId: licIdNum,
                montoOferta: monto,
                plazoEjecucion: Number(plazo),
                observaciones: obs || undefined,
                documentoIds: selected,
              })
            }
          >
            Presentar proposición
          </Button>
          <Button variant="outline" asChild>
            <Link to="/oportunidades">Volver a oportunidades</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to={licIdNum ? `/documentos?licitacionId=${licIdNum}` : "/documentos"}>Adjuntar documentos</Link>
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
            {acuse.manifestHash && (
              <p className="mt-1 break-all font-mono text-[10px] text-emerald-800">manifestHash: {acuse.manifestHash}</p>
            )}
            <p className="mt-2 text-xs text-emerald-800">
              Conserve este acuse. El sobre económico y el manifiesto documental quedan sellados hasta la apertura.
            </p>
            <Link className="mt-2 inline-block text-xs underline" to="/mis-proposiciones">Ver mis proposiciones</Link>
          </div>
        )}
      </div>
    </div>
  );
}
