import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Notificaciones() {
  const [page] = useState(1);
  const [asunto, setAsunto] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [email, setEmail] = useState("");
  const list = trpc.notificaciones.list.useQuery({ page, pageSize: 20 });
  const templates = trpc.notificaciones.listTemplates.useQuery();
  const emitir = trpc.notificaciones.emitir.useMutation({ onSuccess: () => list.refetch() });
  const crearTpl = trpc.notificaciones.crearTemplate.useMutation({ onSuccess: () => templates.refetch() });
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Notificaciones oficiales</h2>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Emitir notificación</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Input placeholder="Asunto" value={asunto} onChange={e => setAsunto(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-sm" />
          <Input placeholder="Cuerpo" value={cuerpo} onChange={e => setCuerpo(e.target.value)} className="bg-slate-700 border-slate-600 text-white flex-1 min-w-[14rem]" />
          <Input placeholder="Email destinatario" value={email} onChange={e => setEmail(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-sm" />
          <Button className="bg-amber-600" disabled={!asunto || !cuerpo || !email || emitir.isPending}
            onClick={() => emitir.mutate({
              codigoEvento: "CONTRATO_FORMALIZADO",
              asunto, cuerpo: cuerpo.length >= 10 ? cuerpo : cuerpo + " — notificación oficial",
              destinatarios: [{ email }], motivo: "Emisión manual de notificación",
            })}>Emitir</Button>
          <Button variant="outline" onClick={() => crearTpl.mutate({
            codigo: `TPL-${Date.now().toString().slice(-6)}`, nombre: "Plantilla operativa",
            asunto: "Aviso oficial ARES", cuerpo: "Cuerpo de plantilla de notificación oficial.",
            motivo: "Alta de plantilla",
          })}>Crear plantilla</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">ID</th>
              <th className="p-3 text-left text-xs text-slate-400">Evento</th>
              <th className="p-3 text-left text-xs text-slate-400">Asunto</th>
              <th className="p-3 text-left text-xs text-slate-400">Estado</th>
            </tr></thead>
            <tbody>
              {(list.data?.items ?? []).map((row: any) => (
                <tr key={row.id} className="border-b border-slate-800">
                  <td className="p-3 text-sm text-white">{row.id}</td>
                  <td className="p-3 text-xs text-slate-300">{row.codigoEvento}</td>
                  <td className="p-3 text-sm text-slate-300">{row.asunto}</td>
                  <td className="p-3 text-xs text-slate-300">{row.estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
