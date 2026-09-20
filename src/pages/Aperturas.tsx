import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useCapability } from "@/hooks/useCapability";

const ACTIONS: Array<{ from: string; label: string; call: string }> = [
  { from: "RECEPCION_ABIERTA", label: "Cerrar recepción", call: "cerrarRecepcion" },
  { from: "RECEPCION_CERRADA", label: "Sellar", call: "sellar" },
  { from: "SELLADA", label: "Abrir", call: "abrir" },
  { from: "ABIERTA", label: "Registrar ofertas", call: "registrarOfertas" },
  { from: "REGISTRADA", label: "Emitir acta", call: "emitirActa" },
  { from: "ACTA_EMITIDA", label: "Publicar", call: "publicar" },
];

export default function Aperturas() {
  useAuth({ redirectOnUnauthenticated: true });
  const { allowed: canPublicar } = useCapability("publicar");
  const [page, setPage] = useState(1);
  const [lic, setLic] = useState("");
  const list = trpc.aperturas.list.useQuery({ page, pageSize: 20 });
  const refetch = () => list.refetch();
  const iniciar = trpc.aperturas.iniciar.useMutation({ onSuccess: refetch });
  const cerrar = trpc.aperturas.cerrarRecepcion.useMutation({ onSuccess: refetch });
  const sellar = trpc.aperturas.sellar.useMutation({ onSuccess: refetch });
  const abrir = trpc.aperturas.abrir.useMutation({ onSuccess: refetch });
  const registrar = trpc.aperturas.registrarOfertas.useMutation({ onSuccess: refetch });
  const acta = trpc.aperturas.emitirActa.useMutation({ onSuccess: refetch });
  const publicar = trpc.aperturas.publicar.useMutation({ onSuccess: refetch });
  const run = (call: string, id: number) => {
    const motivo = `Apertura: ${call}`;
    if (call === "cerrarRecepcion") cerrar.mutate({ id, motivo });
    if (call === "sellar") sellar.mutate({ id, motivo });
    if (call === "abrir") abrir.mutate({ id, motivo });
    if (call === "registrarOfertas") registrar.mutate({ id, motivo });
    if (call === "emitirActa") acta.mutate({ id, actaResumen: "Acta de apertura de proposiciones conforme al procedimiento gobernado.", motivo });
    if (call === "publicar") publicar.mutate({ id, motivo });
  };
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Apertura gobernada</h2>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Iniciar recepción</CardTitle></CardHeader>
        <CardContent className="flex gap-3">
          <Input placeholder="ID licitación" value={lic} onChange={e => setLic(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Button className="bg-amber-600" disabled={!canPublicar || !lic || iniciar.isPending} onClick={() => iniciar.mutate({ licitacionId: Number(lic), motivo: "Inicio de recepción de proposiciones" })}>Iniciar</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">ID</th>
              <th className="p-3 text-left text-xs text-slate-400">Licitación</th>
              <th className="p-3 text-left text-xs text-slate-400">Estado</th>
              <th className="p-3 text-left text-xs text-slate-400">Ofertas</th>
              <th className="p-3 text-right text-xs text-slate-400">Acción</th>
            </tr></thead>
            <tbody>
              {list.data?.items.map(a => {
                const action = ACTIONS.find(x => x.from === a.estado);
                return (
                  <tr key={a.id} className="border-b border-slate-800">
                    <td className="p-3 text-sm text-white">{a.id}</td>
                    <td className="p-3 text-sm text-white">{a.licitacionId}</td>
                    <td className="p-3 text-xs text-slate-300">{a.estado}</td>
                    <td className="p-3 text-xs text-slate-300">{a.ofertasRegistradas}</td>
                    <td className="p-3 text-right">{action && canPublicar && <Button size="sm" onClick={() => run(action.call, a.id)}>{action.label}</Button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
        <span className="self-center text-sm text-slate-400">Página {page}</span>
        <Button variant="outline" disabled={!list.data || page >= list.data.pageCount} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}
