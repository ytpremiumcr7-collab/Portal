import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Aclaraciones() {
  const [page, setPage] = useState(1);
  const [lic, setLic] = useState("");
  const [fecha, setFecha] = useState("");
  const [limite, setLimite] = useState("");
  const list = trpc.aclaraciones.listJuntas.useQuery({ page, pageSize: 20 });
  const crear = trpc.aclaraciones.crearJunta.useMutation({ onSuccess: () => list.refetch() });
  const trans = trpc.aclaraciones.transicionarJunta.useMutation({ onSuccess: () => list.refetch() });
  const nextOf: Record<string, string | undefined> = {
    PROGRAMADA: "ABIERTA", ABIERTA: "CERRADA_PREGUNTAS", CERRADA_PREGUNTAS: "EN_RESPUESTA",
    EN_RESPUESTA: "ACTA_EMITIDA", ACTA_EMITIDA: "PUBLICADA",
  };
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Aclaraciones</h2>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Nueva junta</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Input placeholder="ID licitación" value={lic} onChange={e => setLic(e.target.value)} className="bg-slate-700 border-slate-600 text-white" />
          <Input type="datetime-local" value={fecha} onChange={e => setFecha(e.target.value)} className="bg-slate-700 border-slate-600 text-white" />
          <Input type="datetime-local" value={limite} onChange={e => setLimite(e.target.value)} className="bg-slate-700 border-slate-600 text-white" />
          <Button className="bg-amber-600" disabled={!lic || !fecha || !limite || crear.isPending} onClick={() => crear.mutate({
            licitacionId: Number(lic), fechaProgramada: new Date(fecha).toISOString(), fechaLimitePreguntas: new Date(limite).toISOString(), motivo: "Programación de junta de aclaraciones",
          })}>Crear junta</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">ID</th>
              <th className="p-3 text-left text-xs text-slate-400">Licitación</th>
              <th className="p-3 text-left text-xs text-slate-400">Estado</th>
              <th className="p-3 text-right text-xs text-slate-400">Acción</th>
            </tr></thead>
            <tbody>
              {list.data?.items.map(j => {
                const next = nextOf[j.estado];
                return (
                  <tr key={j.id} className="border-b border-slate-800">
                    <td className="p-3 text-sm text-white">{j.id}</td>
                    <td className="p-3 text-sm text-white">{j.licitacionId}</td>
                    <td className="p-3 text-xs text-slate-300">{j.estado}</td>
                    <td className="p-3 text-right">
                      {next && <Button size="sm" onClick={() => trans.mutate({
                        id: j.id, siguiente: next as any,
                        actaResumen: next === "ACTA_EMITIDA" ? "Acta de junta de aclaraciones emitida conforme al procedimiento." : undefined,
                        motivo: `Avance a ${next}`,
                      })}>{next.replaceAll("_", " ")}</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
        <span className="self-center text-sm text-slate-400">Página {page} de {list.data?.pageCount ?? 1}</span>
        <Button variant="outline" disabled={!list.data || page >= list.data.pageCount} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}
