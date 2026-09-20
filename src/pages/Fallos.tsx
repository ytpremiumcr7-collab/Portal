import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useCapability } from "@/hooks/useCapability";

export default function Fallos() {
  useAuth({ redirectOnUnauthenticated: true });
  const { allowed: canAutorizar } = useCapability("autorizar_fallo");
  const [page, setPage] = useState(1);
  const [lic, setLic] = useState("");
  const [dictamenId, setDictamenId] = useState("");
  const [prov, setProv] = useState("");
  const [monto, setMonto] = useState("");
  const list = trpc.fallos.list.useQuery({ page, pageSize: 20 });
  const crear = trpc.fallos.emitirBorrador.useMutation({ onSuccess: () => list.refetch() });
  const emitir = trpc.fallos.emitir.useMutation({ onSuccess: () => list.refetch() });
  const aprobar = trpc.fallos.aprobar.useMutation({ onSuccess: () => list.refetch() });
  const publicar = trpc.fallos.publicar.useMutation({ onSuccess: () => list.refetch() });
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Fallos</h2>
      <p className="text-sm text-slate-400">Secuencia: emitir borrador → emitir → aprobar → publicar. La adjudicación exige fallo PUBLICADO. Mutaciones requieren capacidad <code className="text-slate-300">autorizar_fallo</code>.</p>
      {!canAutorizar && (
        <p className="text-xs text-amber-400">Sin capacidad autorizar_fallo — las acciones de mutación están deshabilitadas (el servidor es la fuente de verdad).</p>
      )}
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Borrador de fallo (adjudicar)</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <Input placeholder="ID licitación" value={lic} onChange={e => setLic(e.target.value)} className="bg-slate-700 border-slate-600 text-white" />
          <Input placeholder="ID dictamen" value={dictamenId} onChange={e => setDictamenId(e.target.value)} className="bg-slate-700 border-slate-600 text-white" />
          <Input placeholder="ID proveedor" value={prov} onChange={e => setProv(e.target.value)} className="bg-slate-700 border-slate-600 text-white" />
          <Input placeholder="Monto" value={monto} onChange={e => setMonto(e.target.value)} className="bg-slate-700 border-slate-600 text-white" />
          <Button className="bg-amber-600" disabled={!canAutorizar || !lic || !dictamenId || !prov || !monto || crear.isPending} onClick={() => crear.mutate({
            licitacionId: Number(lic), dictamenId: Number(dictamenId), sentido: "ADJUDICAR",
            proveedorGanadorId: Number(prov), montoAdjudicado: monto,
            fundamento: "Fallo de adjudicación con base en el dictamen aprobado y el orden de mérito.",
            motivo: "Emisión de borrador de fallo",
          })}>Crear borrador</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">ID</th>
              <th className="p-3 text-left text-xs text-slate-400">Lic.</th>
              <th className="p-3 text-left text-xs text-slate-400">Sentido</th>
              <th className="p-3 text-left text-xs text-slate-400">Estado</th>
              <th className="p-3 text-right text-xs text-slate-400">Acciones</th>
            </tr></thead>
            <tbody>
              {list.data?.items.map(f => (
                <tr key={f.id} className="border-b border-slate-800">
                  <td className="p-3 text-sm text-white">{f.id}</td>
                  <td className="p-3 text-sm text-white">{f.licitacionId}</td>
                  <td className="p-3 text-xs text-slate-300">{f.sentido}</td>
                  <td className="p-3 text-xs text-slate-300">{f.estado}</td>
                  <td className="p-3 text-right flex justify-end gap-2">
                    {f.estado === "BORRADOR" && canAutorizar && <Button size="sm" onClick={() => emitir.mutate({ id: f.id, motivo: "Emisión del fallo" })}>Emitir</Button>}
                    {f.estado === "EMITIDO" && canAutorizar && <Button size="sm" onClick={() => aprobar.mutate({ id: f.id, motivo: "Aprobación del fallo" })}>Aprobar</Button>}
                    {f.estado === "APROBADO" && canAutorizar && <Button size="sm" onClick={() => publicar.mutate({ id: f.id, motivo: "Publicación del fallo" })}>Publicar</Button>}
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
