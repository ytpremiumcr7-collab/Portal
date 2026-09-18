import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Garantias() {
  const [page, setPage] = useState(1);
  const [contratoId, setContratoId] = useState("");
  const [monto, setMonto] = useState("");
  const list = trpc.garantias.list.useQuery({ page, pageSize: 20 });
  const requerir = trpc.garantias.requerir.useMutation({ onSuccess: () => list.refetch() });
  const presentar = trpc.garantias.presentar.useMutation({ onSuccess: () => list.refetch() });
  const activar = trpc.garantias.activar.useMutation({ onSuccess: () => list.refetch() });
  const liberar = trpc.garantias.liberar.useMutation({ onSuccess: () => list.refetch() });
  const today = new Date().toISOString().slice(0, 10);
  const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Garantías</h2>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Requerir garantía de cumplimiento</CardTitle></CardHeader>
        <CardContent className="flex gap-3 flex-wrap">
          <Input placeholder="ID contrato" value={contratoId} onChange={e => setContratoId(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Input placeholder="Monto" value={monto} onChange={e => setMonto(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Button className="bg-amber-600" disabled={!contratoId || !monto || requerir.isPending} onClick={() => requerir.mutate({ contratoId: Number(contratoId), tipo: "CUMPLIMIENTO", monto, motivo: "Requerimiento de garantía de cumplimiento" })}>Requerir</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">ID</th>
              <th className="p-3 text-left text-xs text-slate-400">Contrato</th>
              <th className="p-3 text-left text-xs text-slate-400">Tipo</th>
              <th className="p-3 text-left text-xs text-slate-400">Monto</th>
              <th className="p-3 text-left text-xs text-slate-400">Estado</th>
              <th className="p-3 text-right text-xs text-slate-400">Acción</th>
            </tr></thead>
            <tbody>
              {list.data?.items.map(g => (
                <tr key={g.id} className="border-b border-slate-800">
                  <td className="p-3 text-sm text-white">{g.id}</td>
                  <td className="p-3 text-sm text-white">{g.contratoId}</td>
                  <td className="p-3 text-xs text-slate-300">{g.tipo}</td>
                  <td className="p-3 text-sm text-white">${g.monto}</td>
                  <td className="p-3 text-xs text-slate-300">{g.estado}</td>
                  <td className="p-3 text-right flex justify-end gap-2">
                    {g.estado === "REQUERIDA" && <Button size="sm" onClick={() => presentar.mutate({ id: g.id, instrumento: "Póliza de fianza", numeroPoliza: `POL-${g.id}`, fechaInicio: today, fechaVencimiento: nextYear, motivo: "Presentación de garantía" })}>Presentar</Button>}
                    {g.estado === "PRESENTADA" && <Button size="sm" onClick={() => activar.mutate({ id: g.id, motivo: "Activación de garantía" })}>Activar</Button>}
                    {g.estado === "VIGENTE" && <Button size="sm" variant="outline" onClick={() => liberar.mutate({ id: g.id, motivo: "Liberación de garantía" })}>Liberar</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
        <Button variant="outline" disabled={!list.data || page >= list.data.pageCount} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}
