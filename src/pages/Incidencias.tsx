import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Incidencias() {
  const [page, setPage] = useState(1);
  const [contratoId, setContratoId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const list = trpc.incidencias.list.useQuery({ page, pageSize: 20 });
  const reportar = trpc.incidencias.reportar.useMutation({ onSuccess: () => list.refetch() });
  const trans = trpc.incidencias.transicionar.useMutation({ onSuccess: () => list.refetch() });
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Incidencias</h2>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Abrir incidencia</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Input placeholder="Contrato ID" value={contratoId} onChange={e => setContratoId(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[8rem]" />
          <Input placeholder="Título" value={titulo} onChange={e => setTitulo(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-sm" />
          <Input placeholder="Descripción" value={descripcion} onChange={e => setDescripcion(e.target.value)} className="bg-slate-700 border-slate-600 text-white flex-1 min-w-[12rem]" />
          <Button className="bg-amber-600" disabled={!contratoId || !titulo || reportar.isPending}
            onClick={() => reportar.mutate({ contratoId: Number(contratoId), titulo, descripcion: descripcion.length >= 10 ? descripcion : (descripcion || "Incidencia contractual reportada"), tipo: "OBSERVACION", motivo: "Apertura de incidencia" })}>Reportar</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">ID</th>
              <th className="p-3 text-left text-xs text-slate-400">Título</th>
              <th className="p-3 text-left text-xs text-slate-400">Estado</th>
              <th className="p-3 text-right text-xs text-slate-400">Acción</th>
            </tr></thead>
            <tbody>
              {(list.data?.items ?? []).map((row: any) => (
                <tr key={row.id} className="border-b border-slate-800">
                  <td className="p-3 text-sm text-white">{row.id}</td>
                  <td className="p-3 text-sm text-slate-300">{row.titulo ?? row.folio ?? "—"}</td>
                  <td className="p-3 text-xs text-slate-300">{row.estado}</td>
                  <td className="p-3 text-right space-x-2">
                    {row.estado === "ABIERTA" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "EN_ANALISIS", motivo: "Analizar" })}>Analizar</Button>}
                    {row.estado === "EN_ANALISIS" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "ACCION_CORRECTIVA", motivo: "Acción correctiva" })}>Correctiva</Button>}
                    {row.estado === "ACCION_CORRECTIVA" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "RESUELTA", motivo: "Resolver" })}>Resolver</Button>}
                    {row.estado === "RESUELTA" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "CERRADA", motivo: "Cerrar" })}>Cerrar</Button>}
                  </td>
                </tr>
              ))}
              {!list.data?.items?.length && <tr><td colSpan={4} className="p-4 text-slate-500 text-sm">Sin registros</td></tr>}
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
