import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Pagos() {
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
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Pagos / Estimaciones</h2>
      <p className="text-sm text-slate-400">SoD: presentar_pago ≠ aprobar_pago. Flujo PRESENTADA → EN_REVISION → AUTORIZADA → PAGADA.</p>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Presentar estimación</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Input placeholder="Contrato ID" value={contratoId} onChange={e => setContratoId(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[8rem]" />
          <Input placeholder="Folio" value={folio} onChange={e => setFolio(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Input placeholder="Número" value={numero} onChange={e => setNumero(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[6rem]" />
          <Input placeholder="Monto bruto" value={monto} onChange={e => setMonto(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[10rem]" />
          <Button className="bg-amber-600" disabled={!contratoId || !folio || !monto || presentar.isPending}
            onClick={() => presentar.mutate({ contratoId: Number(contratoId), folio, numero: Number(numero), montoBruto: monto, retencion: "0.00", motivo: "Presentación de estimación" })}>Presentar</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">ID</th>
              <th className="p-3 text-left text-xs text-slate-400">Folio</th>
              <th className="p-3 text-left text-xs text-slate-400">Neto</th>
              <th className="p-3 text-left text-xs text-slate-400">Estado</th>
              <th className="p-3 text-right text-xs text-slate-400">Acción</th>
            </tr></thead>
            <tbody>
              {(list.data?.items ?? []).map((row: any) => (
                <tr key={row.id} className="border-b border-slate-800">
                  <td className="p-3 text-sm text-white">{row.id}</td>
                  <td className="p-3 text-sm text-slate-300">{row.folio}</td>
                  <td className="p-3 text-sm text-slate-300">${row.montoNeto}</td>
                  <td className="p-3 text-xs text-slate-300">{row.estado}</td>
                  <td className="p-3 text-right space-x-2">
                    {row.estado === "PRESENTADA" && <Button size="sm" onClick={() => revisar.mutate({ id: row.id, motivo: "Pasar a revisión" })}>Revisar</Button>}
                    {row.estado === "EN_REVISION" && <>
                      <Button size="sm" onClick={() => autorizar.mutate({ id: row.id, motivo: "Autorizar pago" })}>Autorizar</Button>
                      <Button size="sm" variant="outline" onClick={() => rechazar.mutate({ id: row.id, motivoRechazo: "No procede la estimación presentada", motivo: "Rechazo" })}>Rechazar</Button>
                    </>}
                    {row.estado === "AUTORIZADA" && <Button size="sm" onClick={() => pagar.mutate({ id: row.id, motivo: "Registrar pago" })}>Pagar</Button>}
                  </td>
                </tr>
              ))}
              {!list.data?.items?.length && <tr><td colSpan={5} className="p-4 text-slate-500 text-sm">Sin registros</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
        <Button variant="outline" disabled={!list.data || page >= (list.data.pageCount ?? 1)} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}
