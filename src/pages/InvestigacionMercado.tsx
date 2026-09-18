import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function InvestigacionMercado() {
  const [page, setPage] = useState(1);
  const list = trpc.investigacionMercado.list.useQuery({ page, pageSize: 20 });
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Investigación de mercado</h2>
      <p className="text-sm text-slate-400">Cotizaciones de mercado ≠ participación/oferta.</p>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Registros</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">ID</th>
              <th className="p-3 text-left text-xs text-slate-400">Detalle</th>
              <th className="p-3 text-left text-xs text-slate-400">Estado</th>
            </tr></thead>
            <tbody>
              {(list.data?.items ?? []).map((row: any) => (
                <tr key={row.id} className="border-b border-slate-800">
                  <td className="p-3 text-sm text-white">{row.id}</td>
                  <td className="p-3 text-sm text-slate-300">{row.folio ?? row.titulo ?? row.nombre ?? row.asunto ?? row.codigo ?? "—"}</td>
                  <td className="p-3 text-xs text-slate-300">{row.estado ?? "—"}</td>
                </tr>
              ))}
              {!list.data?.items?.length && <tr><td colSpan={3} className="p-4 text-slate-500 text-sm">Sin registros</td></tr>}
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
