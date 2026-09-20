import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useCapability } from "@/hooks/useCapability";

export default function Dictamenes() {
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const { allowed: canEmitir } = useCapability("emitir_dictamen");
  const { allowed: canAprobar } = useCapability("aprobar_juridico");
  const [page, setPage] = useState(1);
  const [lic, setLic] = useState("");
  const [prov, setProv] = useState("");
  const [monto, setMonto] = useState("");
  const list = trpc.dictamenes.list.useQuery({ page, pageSize: 20 });
  const crear = trpc.dictamenes.crear.useMutation({ onSuccess: () => list.refetch() });
  const firmar = trpc.dictamenes.firmar.useMutation({ onSuccess: () => list.refetch() });
  const emitir = trpc.dictamenes.emitir.useMutation({ onSuccess: () => list.refetch() });
  const aprobar = trpc.dictamenes.aprobar.useMutation({ onSuccess: () => list.refetch() });
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Dictámenes</h2>
      <p className="text-xs text-slate-400">
        La acción «Firmar» registra una <strong className="text-slate-300">confirmación de sesión autenticada</strong> (SESSION_CONFIRMATION).
        No es e.firma ni FIEL del SAT; la firma criptográfica calificada queda pendiente de proveedor SatEFirma.
      </p>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Nuevo dictamen (recomendar adjudicación)</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Input placeholder="ID licitación" value={lic} onChange={e => setLic(e.target.value)} className="bg-slate-700 border-slate-600 text-white" />
          <Input placeholder="ID proveedor 1er lugar" value={prov} onChange={e => setProv(e.target.value)} className="bg-slate-700 border-slate-600 text-white" />
          <Input placeholder="Monto" value={monto} onChange={e => setMonto(e.target.value)} className="bg-slate-700 border-slate-600 text-white" />
          <Button className="bg-amber-600" disabled={!user || !canEmitir || !lic || !prov || !monto || crear.isPending} onClick={() => crear.mutate({
            licitacionId: Number(lic), resultado: "RECOMENDAR_ADJUDICACION", proveedorRecomendadoId: Number(prov), montoRecomendado: monto,
            fundamento: "Dictamen técnico-económico conforme a la evaluación concluida y al criterio de adjudicación vigente.",
            firmantes: [{ usuarioId: user!.id, rolFirma: "EVALUADOR" }],
            motivo: "Elaboración de dictamen post-evaluación",
          })}>Crear</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">ID</th>
              <th className="p-3 text-left text-xs text-slate-400">Lic.</th>
              <th className="p-3 text-left text-xs text-slate-400">Ver.</th>
              <th className="p-3 text-left text-xs text-slate-400">Estado</th>
              <th className="p-3 text-right text-xs text-slate-400">Acciones</th>
            </tr></thead>
            <tbody>
              {list.data?.items.map(d => (
                <tr key={d.id} className="border-b border-slate-800">
                  <td className="p-3 text-sm text-white">{d.id}</td>
                  <td className="p-3 text-sm text-white">{d.licitacionId}</td>
                  <td className="p-3 text-sm text-white">{d.version}</td>
                  <td className="p-3 text-xs text-slate-300">{d.estado}</td>
                  <td className="p-3 text-right flex justify-end gap-2">
                    {d.estado === "BORRADOR" && canEmitir && <Button size="sm" variant="outline" onClick={() => firmar.mutate({ dictamenId: d.id, motivo: "Confirmación de sesión del dictamen" })}>Confirmar sesión</Button>}
                    {d.estado === "BORRADOR" && canEmitir && <Button size="sm" onClick={() => emitir.mutate({ id: d.id, motivo: "Emisión del dictamen" })}>Emitir</Button>}
                    {d.estado === "EMITIDO" && canAprobar && <Button size="sm" onClick={() => aprobar.mutate({ id: d.id, motivo: "Aprobación del dictamen" })}>Aprobar</Button>}
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
