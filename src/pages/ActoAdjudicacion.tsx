import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";

export default function ActoAdjudicacion() {
  const [licitacionId, setLicitacionId] = useState("");
  const [fundamento, setFundamento] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [desviacion, setDesviacion] = useState(false);
  const idNum = Number(licitacionId) || 0;
  const actoQ = trpc.actoAdjudicacion.getByLicitacion.useQuery({ licitacionId: idNum }, { enabled: idNum > 0 });
  const proponer = trpc.actoAdjudicacion.proponer.useMutation({ onSuccess: () => actoQ.refetch() });
  const decidir = trpc.actoAdjudicacion.decidir.useMutation({ onSuccess: () => actoQ.refetch() });
  const publicar = trpc.actoAdjudicacion.publicar.useMutation({ onSuccess: () => actoQ.refetch() });
  const a = actoQ.data;
  const ranking = (a?.propuestaRankingJson as any[] | undefined) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Acto de adjudicación"
        description="Propuesta de ranking del sistema, decisión de la autoridad y publicación del acto. La adjudicación exige acto PUBLICADO."
        breadcrumbs={[{ label: "Dependencia" }, { label: "Acto de adjudicación" }]}
      />
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 px-4 py-3">
          <CardTitle className="text-sm font-semibold text-slate-900">Procedimiento</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600">ID licitación</Label>
            <Input value={licitacionId} onChange={(e) => setLicitacionId(e.target.value)} className="max-w-[10rem]" />
          </div>
          <Button disabled={!idNum || proponer.isPending}
            onClick={() => proponer.mutate({ licitacionId: idNum, motivo: "Propuesta de acto conforme al ranking del sistema" })}>
            Proponer ranking
          </Button>
        </CardContent>
      </Card>
      {a && (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 px-4 py-3">
            <CardTitle className="text-sm font-semibold text-slate-900">Acto #{a.id}</CardTitle>
            <StatusBadge status={a.estado} />
          </CardHeader>
          <CardContent className="space-y-4 p-4 text-sm text-slate-700">
            <p>Proveedor propuesto (sistema): <strong>{a.proveedorPropuestoId}</strong></p>
            <p>Proveedor decidido: <strong>{a.proveedorDecididoId ?? "—"}</strong></p>
            <p>Validado vs ranking: {a.validadoVsRanking ? "Sí" : "No"} · Desviación justificada: {a.desviacionJustificada ? "Sí" : "No"}</p>
            {ranking.length > 0 && (
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="p-2">Orden</th>
                      <th className="p-2">Participación</th>
                      <th className="p-2">Proveedor</th>
                      <th className="p-2">Monto</th>
                      <th className="p-2">Puntaje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((r) => (
                      <tr key={r.participacionId} className="border-t border-slate-100">
                        <td className="p-2">{r.orden}</td>
                        <td className="p-2">{r.participacionId}</td>
                        <td className="p-2">{r.proveedorId}</td>
                        <td className="p-2">{r.montoOferta}</td>
                        <td className="p-2">{r.puntajeTotal ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {["BORRADOR", "PROPUESTO"].includes(a.estado) && (
              <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-4">
                <Input placeholder="Proveedor decidido (ID)" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className="max-w-[12rem]" />
                <Input placeholder="Fundamento" value={fundamento} onChange={(e) => setFundamento(e.target.value)} className="min-w-[16rem] flex-1" />
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={desviacion} onChange={(e) => setDesviacion(e.target.checked)} />
                  Desviación justificada
                </label>
                <Button disabled={!proveedorId || fundamento.length < 10 || decidir.isPending}
                  onClick={() => decidir.mutate({
                    id: a.id, proveedorId: Number(proveedorId), fundamento,
                    desviacionJustificada: desviacion, motivo: "Decisión de autoridad sobre el acto",
                  })}>
                  Registrar decisión
                </Button>
              </div>
            )}
            {a.estado === "PROPUESTO" && (
              <Button disabled={publicar.isPending}
                onClick={() => publicar.mutate({ id: a.id, motivo: "Publicación del acto de adjudicación" })}>
                Publicar acto
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
