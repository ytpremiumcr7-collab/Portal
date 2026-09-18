import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function InvestigacionMercado() {
  const [page, setPage] = useState(1);
  const [folio, setFolio] = useState("");
  const [objeto, setObjeto] = useState("");
  const list = trpc.investigacionMercado.list.useQuery({ page, pageSize: 20 });
  const crear = trpc.investigacionMercado.crear.useMutation({ onSuccess: () => list.refetch() });
  const trans = trpc.investigacionMercado.transicionar.useMutation({ onSuccess: () => list.refetch() });
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Investigación de mercado</h2>
      <p className="text-sm text-slate-400">Consulta de proveedores y cotizaciones — distinta de participación/oferta.</p>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Abrir investigación</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Input placeholder="Folio" value={folio} onChange={e => setFolio(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Input placeholder="Objeto / descripción" value={objeto} onChange={e => setObjeto(e.target.value)} className="bg-slate-700 border-slate-600 text-white flex-1 min-w-[14rem]" />
          <Button className="bg-amber-600" disabled={!folio || !objeto || crear.isPending}
            onClick={() => crear.mutate({ folio, objeto: objeto.length >= 10 ? objeto : objeto + " — consulta de mercado", motivo: "Apertura investigación de mercado" } as any)}>Crear</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">ID</th>
              <th className="p-3 text-left text-xs text-slate-400">Detalle</th>
              <th className="p-3 text-left text-xs text-slate-400">Estado</th>
              <th className="p-3 text-right text-xs text-slate-400">Acción</th>
            </tr></thead>
            <tbody>
              {(list.data?.items ?? []).map((row: any) => (
                <tr key={row.id} className="border-b border-slate-800">
                  <td className="p-3 text-sm text-white">{row.id}</td>
                  <td className="p-3 text-sm text-slate-300">{row.folio ?? row.objeto ?? "—"}</td>
                  <td className="p-3 text-xs text-slate-300">{row.estado}</td>
                  <td className="p-3 text-right space-x-2">
                    {row.estado === "BORRADOR" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "EN_CONSULTA", motivo: "Abrir consulta" })}>Consultar</Button>}
                    {row.estado === "EN_CONSULTA" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "CERRADA", motivo: "Cerrar consulta" })}>Cerrar</Button>}
                    {row.estado === "CERRADA" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "CONCLUIDA", motivo: "Concluir investigación" })}>Concluir</Button>}
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
