import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useCapability } from "@/hooks/useCapability";

type DecisionDraft = {
  outcome: "ADJUDICAR" | "DESIERTO" | "CANCELAR";
  participationId?: number;
  reason: string;
};

const money = (value: string | null) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN",
}).format(Number(value ?? 0));

export default function Fallos() {
  useAuth({ redirectOnUnauthenticated: true });
  const { allowed: canAutorizar } = useCapability("autorizar_fallo");
  const [page, setPage] = useState(1);
  const [licitacionId, setLicitacionId] = useState("");
  const [fundamento, setFundamento] = useState("");
  const [decisions, setDecisions] = useState<Record<number, DecisionDraft>>({});
  const licId = Number(licitacionId) || 0;

  const procedures = trpc.licitaciones.list.useQuery({ estado: "EN_EVALUACION", page: 1, pageSize: 100 });
  const preparation = trpc.fallos.prepararBorrador.useQuery(
    { licitacionId: licId },
    { enabled: licId > 0 },
  );
  const list = trpc.fallos.list.useQuery({ page, pageSize: 20 });
  const crear = trpc.fallos.emitirBorrador.useMutation({
    onSuccess: async () => {
      await Promise.all([list.refetch(), preparation.refetch()]);
    },
  });
  const emitir = trpc.fallos.emitir.useMutation({ onSuccess: () => list.refetch() });
  const aprobar = trpc.fallos.aprobar.useMutation({ onSuccess: () => list.refetch() });
  const publicar = trpc.fallos.publicar.useMutation({ onSuccess: () => list.refetch() });

  const decisionFor = (lot: NonNullable<typeof preparation.data>["lots"][number]): DecisionDraft => {
    const stored = decisions[lot.id];
    if (stored) return stored;
    const first = lot.offers.find((offer) => offer.ordenMerito === 1) ?? lot.offers[0];
    return first
      ? { outcome: "ADJUDICAR", participationId: first.id, reason: "" }
      : { outcome: "DESIERTO", reason: "" };
  };

  const preparationData = preparation.data;
  const ready = Boolean(
    preparationData?.dictamen &&
    !preparationData.existing &&
    preparationData.lots.length &&
    fundamento.trim().length >= 20 &&
    preparationData.lots.every((lot) => {
      const decision = decisionFor(lot);
      return decision.reason.trim().length >= 20 &&
        (decision.outcome !== "ADJUDICAR" || Boolean(decision.participationId));
    }),
  );

  const updateDecision = (lotId: number, patch: Partial<DecisionDraft>) => {
    setDecisions((current) => ({
      ...current,
      [lotId]: { ...current[lotId], outcome: current[lotId]?.outcome ?? "DESIERTO", reason: current[lotId]?.reason ?? "", ...patch },
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Fallo por lotes</h2>
        <p className="mt-1 text-sm text-slate-400">Cada lote recibe una decisión explícita. Las adjudicaciones publicadas generan awards independientes.</p>
      </div>
      {!canAutorizar && <p className="text-xs text-amber-400">Sin capacidad autorizar_fallo; las mutaciones permanecen bloqueadas en servidor.</p>}

      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Preparar fallo</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-slate-300">Procedimiento en evaluación</Label>
              <Select value={licitacionId} onValueChange={(value) => { setLicitacionId(value); setDecisions({}); }}>
                <SelectTrigger className="border-slate-600 bg-slate-700 text-white"><SelectValue placeholder="Seleccione procedimiento" /></SelectTrigger>
                <SelectContent>
                  {(procedures.data?.items ?? []).map((lic) => (
                    <SelectItem key={lic.id} value={String(lic.id)}>{lic.codigo} · {lic.titulo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Fundamento general</Label>
              <Input value={fundamento} onChange={(event) => setFundamento(event.target.value)} placeholder="Motivación general del fallo" className="border-slate-600 bg-slate-700 text-white" />
            </div>
          </div>

          {preparation.data && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                Dictamen: {preparation.data.dictamen ? `#${preparation.data.dictamen.id} v${preparation.data.dictamen.version} APROBADO` : "faltante"}
                {preparation.data.existing ? ` · Ya existe fallo #${preparation.data.existing.id}` : ""}
              </p>
              {preparation.data.lots.map((lot) => {
                const decision = decisionFor(lot);
                return (
                  <div key={lot.id} className="rounded border border-slate-700 p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-white">{lot.code} · {lot.title}</p>
                        <p className="text-xs text-slate-400">{lot.offers.length} oferta(s) admisible(s)</p>
                      </div>
                      <Select value={decision?.outcome ?? "DESIERTO"} onValueChange={(value: DecisionDraft["outcome"]) => updateDecision(lot.id, {
                        outcome: value,
                        participationId: value === "ADJUDICAR" ? decision?.participationId ?? lot.offers[0]?.id : undefined,
                      })}>
                        <SelectTrigger className="w-44 border-slate-600 bg-slate-700 text-white"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ADJUDICAR">Adjudicar</SelectItem>
                          <SelectItem value="DESIERTO">Declarar desierto</SelectItem>
                          <SelectItem value="CANCELAR">Cancelar lote</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {decision?.outcome === "ADJUDICAR" && (
                        <Select value={decision.participationId ? String(decision.participationId) : ""} onValueChange={(value) => updateDecision(lot.id, { participationId: Number(value) })}>
                          <SelectTrigger className="border-slate-600 bg-slate-700 text-white"><SelectValue placeholder="Oferta ganadora" /></SelectTrigger>
                          <SelectContent>
                            {lot.offers.map((offer) => (
                              <SelectItem key={offer.id} value={String(offer.id)}>
                                #{offer.ordenMerito ?? "—"} · {offer.proveedor} · {money(offer.montoOferta)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Input value={decision?.reason ?? ""} onChange={(event) => updateDecision(lot.id, { reason: event.target.value })} placeholder="Fundamento específico del lote (mín. 20 caracteres)" className="border-slate-600 bg-slate-700 text-white" />
                    </div>
                  </div>
                );
              })}
              <Button className="bg-amber-600" disabled={!canAutorizar || !ready || crear.isPending} onClick={() => {
                const data = preparation.data;
                if (!data?.dictamen) return;
                crear.mutate({
                  licitacionId: data.licitacion.id,
                  dictamenId: data.dictamen.id,
                  fundamento,
                  decisions: data.lots.map((lot) => ({ lotId: lot.id, ...decisionFor(lot) })),
                  motivo: "Creación gobernada del borrador de fallo por lotes",
                });
              }}>Crear borrador por lotes</Button>
              {crear.error && <p className="text-sm text-red-400">{crear.error.message}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-800/50">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-slate-700">
                <th className="p-3 text-left text-xs text-slate-400">Fallo / procedimiento</th>
                <th className="p-3 text-left text-xs text-slate-400">Decisiones</th>
                <th className="p-3 text-left text-xs text-slate-400">Estado</th>
                <th className="p-3 text-right text-xs text-slate-400">Acciones</th>
              </tr></thead>
              <tbody>
                {list.data?.items.map((fallo) => (
                  <tr key={fallo.id} className="border-b border-slate-800 align-top">
                    <td className="p-3 text-sm text-white">#{fallo.id}<br /><span className="text-xs text-slate-400">Procedimiento #{fallo.licitacionId}</span></td>
                    <td className="p-3 text-xs text-slate-300">
                      <ul className="space-y-1">
                        {fallo.decisions.map((decision) => (
                          <li key={decision.id}>{decision.lotCode}: {decision.outcome}{decision.proveedor ? ` · ${decision.proveedor} · ${money(decision.amount)}` : ""}</li>
                        ))}
                      </ul>
                    </td>
                    <td className="p-3 text-xs text-slate-300">{fallo.estado}</td>
                    <td className="flex justify-end gap-2 p-3 text-right">
                      {fallo.estado === "BORRADOR" && canAutorizar && <Button size="sm" onClick={() => emitir.mutate({ id: fallo.id, motivo: "Emisión del fallo" })}>Emitir</Button>}
                      {fallo.estado === "EMITIDO" && canAutorizar && <Button size="sm" onClick={() => aprobar.mutate({ id: fallo.id, motivo: "Aprobación del fallo" })}>Aprobar</Button>}
                      {fallo.estado === "APROBADO" && canAutorizar && <Button size="sm" onClick={() => publicar.mutate({ id: fallo.id, motivo: "Publicación del fallo y sus adjudicaciones" })}>Publicar</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</Button>
        <Button variant="outline" disabled={!list.data || page >= list.data.pageCount} onClick={() => setPage((value) => value + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}
