import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Planeacion() {
  const [page, setPage] = useState(1);
  const [folio, setFolio] = useState("");
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [justificacion, setJustificacion] = useState("");
  const [entidadId, setEntidadId] = useState("");
  const [monto, setMonto] = useState("");
  const [necId, setNecId] = useState("");
  const [to, setTo] = useState("EN_REVISION");
  const list = trpc.planeacion.listNecesidades.useQuery({ page, pageSize: 20 });
  const crear = trpc.planeacion.crearNecesidad.useMutation({ onSuccess: () => list.refetch() });
  const trans = trpc.planeacion.transicionarNecesidad.useMutation({ onSuccess: () => list.refetch() });
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Planeación</h2>
      <p className="text-sm text-slate-400">Necesidades → revisión → aprobación → vinculación a procedimiento.</p>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Nueva necesidad</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Input placeholder="Entidad ID" value={entidadId} onChange={e => setEntidadId(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[8rem]" />
          <Input placeholder="Folio" value={folio} onChange={e => setFolio(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Input placeholder="Título" value={titulo} onChange={e => setTitulo(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-sm" />
          <Input placeholder="Monto estimado" value={monto} onChange={e => setMonto(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[10rem]" />
          <Input placeholder="Descripción" value={descripcion} onChange={e => setDescripcion(e.target.value)} className="bg-slate-700 border-slate-600 text-white flex-1 min-w-[12rem]" />
          <Input placeholder="Justificación" value={justificacion} onChange={e => setJustificacion(e.target.value)} className="bg-slate-700 border-slate-600 text-white flex-1 min-w-[12rem]" />
          <Button className="bg-amber-600" disabled={crear.isPending || !folio || !titulo || !entidadId || !monto}
            onClick={() => crear.mutate({
              entidadId: Number(entidadId), folio, titulo,
              descripcion: descripcion || "Necesidad operativa registrada",
              justificacion: justificacion || "Justificación de la necesidad operativa",
              montoEstimado: monto, tipoContratacion: "BIENES", motivo: "Alta de necesidad",
            })}>Crear</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Transicionar necesidad</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Input placeholder="ID necesidad" value={necId} onChange={e => setNecId(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[8rem]" />
          <Input placeholder="EN_REVISION | APROBADA | RECHAZADA" value={to} onChange={e => setTo(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Button disabled={!necId || trans.isPending} onClick={() => trans.mutate({ id: Number(necId), to: to as any, motivo: `Transición a ${to}` })}>Aplicar</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Necesidades</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">ID</th>
              <th className="p-3 text-left text-xs text-slate-400">Folio / Título</th>
              <th className="p-3 text-left text-xs text-slate-400">Estado</th>
              <th className="p-3 text-right text-xs text-slate-400">Acción</th>
            </tr></thead>
            <tbody>
              {(list.data?.items ?? []).map((row: any) => (
                <tr key={row.id} className="border-b border-slate-800">
                  <td className="p-3 text-sm text-white">{row.id}</td>
                  <td className="p-3 text-sm text-slate-300">{row.folio} — {row.titulo}</td>
                  <td className="p-3 text-xs text-slate-300">{row.estado}</td>
                  <td className="p-3 text-right space-x-2">
                    {row.estado === "BORRADOR" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "EN_REVISION", motivo: "Enviar a revisión" })}>Revisar</Button>}
                    {row.estado === "EN_REVISION" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "APROBADA", motivo: "Aprobar necesidad" })}>Aprobar</Button>}
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
