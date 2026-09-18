import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Sanciones() {
  const [page, setPage] = useState(1);
  const [proveedorId, setProveedorId] = useState("");
  const [folio, setFolio] = useState("");
  const [resumen, setResumen] = useState("");
  const [alertaId, setAlertaId] = useState("");
  const list = trpc.sanciones.list.useQuery({ page, pageSize: 20 });
  const invs = trpc.sanciones.listInvestigaciones.useQuery({ page: 1, pageSize: 20 });
  const abrir = trpc.sanciones.abrirInvestigacion.useMutation({ onSuccess: () => { invs.refetch(); list.refetch(); } });
  const transInv = trpc.sanciones.transicionarInvestigacion.useMutation({ onSuccess: () => invs.refetch() });
  const crear = trpc.sanciones.crear.useMutation({ onSuccess: () => list.refetch() });
  const trans = trpc.sanciones.transicionar.useMutation({ onSuccess: () => list.refetch() });
  const sync = trpc.sanciones.syncImpedimentos.useMutation();
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Sanciones e investigaciones</h2>
      <p className="text-sm text-slate-400">ALERTA ≠ SANCIÓN. Flujo investigación: ABIERTA → EN_TRAMITE → CERRADA_SIN_SANCION o derivar sanción.</p>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Abrir investigación</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Input placeholder="Proveedor ID" value={proveedorId} onChange={e => setProveedorId(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[8rem]" />
          <Input placeholder="Folio" value={folio} onChange={e => setFolio(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Input placeholder="Alerta ID (opcional)" value={alertaId} onChange={e => setAlertaId(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[8rem]" />
          <Input placeholder="Resumen" value={resumen} onChange={e => setResumen(e.target.value)} className="bg-slate-700 border-slate-600 text-white flex-1 min-w-[12rem]" />
          <Button className="bg-amber-600" disabled={!proveedorId || !folio || abrir.isPending}
            onClick={() => abrir.mutate({
              proveedorId: Number(proveedorId), folio,
              resumen: resumen.length >= 10 ? resumen : "Investigación por posible irregularidad",
              alertaId: alertaId ? Number(alertaId) : undefined,
              motivo: "Apertura de investigación",
            })}>Abrir investigación</Button>
          <Button variant="outline" onClick={() => sync.mutate()}>Sync impedimentos</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Investigaciones</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">ID</th>
              <th className="p-3 text-left text-xs text-slate-400">Folio</th>
              <th className="p-3 text-left text-xs text-slate-400">Estado</th>
              <th className="p-3 text-right text-xs text-slate-400">Acción</th>
            </tr></thead>
            <tbody>
              {(invs.data?.items ?? []).map((row: any) => (
                <tr key={row.id} className="border-b border-slate-800">
                  <td className="p-3 text-sm text-white">{row.id}</td>
                  <td className="p-3 text-sm text-slate-300">{row.folio}</td>
                  <td className="p-3 text-xs text-slate-300">{row.estado}</td>
                  <td className="p-3 text-right space-x-2">
                    {row.estado === "ABIERTA" && <Button size="sm" onClick={() => transInv.mutate({ id: row.id, to: "EN_TRAMITE", motivo: "Tramitar" })}>Tramitar</Button>}
                    {["ABIERTA","EN_TRAMITE"].includes(row.estado) && <Button size="sm" variant="outline" onClick={() => transInv.mutate({ id: row.id, to: "CERRADA_SIN_SANCION", motivo: "Cierre sin sanción" })}>Cerrar sin sanción</Button>}
                    {["ABIERTA","EN_TRAMITE"].includes(row.estado) && <Button size="sm" onClick={() => crear.mutate({
                      proveedorId: row.proveedorId, investigacionId: row.id, fromAlertaId: row.alertaId ?? undefined,
                      tipo: "AMONESTACION", fundamento: "Fundamento derivado de la investigación",
                      autoridad: "Área de responsabilidades", resolucion: "Se determina amonestación conforme a investigación",
                      folio: `SAN-${row.folio}`, motivo: "Derivar a sanción",
                    })}>Derivar sanción</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Sanciones</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">ID</th>
              <th className="p-3 text-left text-xs text-slate-400">Folio</th>
              <th className="p-3 text-left text-xs text-slate-400">Estado</th>
              <th className="p-3 text-right text-xs text-slate-400">Acción</th>
            </tr></thead>
            <tbody>
              {(list.data?.items ?? []).map((row: any) => (
                <tr key={row.id} className="border-b border-slate-800">
                  <td className="p-3 text-sm text-white">{row.id}</td>
                  <td className="p-3 text-sm text-slate-300">{row.folio}</td>
                  <td className="p-3 text-xs text-slate-300">{row.estado}</td>
                  <td className="p-3 text-right space-x-2">
                    {row.estado === "BORRADOR" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "EMITIDA", motivo: "Emitir" })}>Emitir</Button>}
                    {row.estado === "EMITIDA" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "VIGENTE", motivo: "Vigencia" })}>Vigente</Button>}
                    {row.estado === "VIGENTE" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "CUMPLIDA", motivo: "Cumplida" })}>Cumplir</Button>}
                  </td>
                </tr>
              ))}
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
