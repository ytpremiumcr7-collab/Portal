import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ares/PageHeader";

export default function Calendario() {
  const [licitacionId, setLicitacionId] = useState("");
  const [acto, setActo] = useState("RECEPCION");
  const [inicio, setInicio] = useState("");
  const [fin, setFin] = useState("");
  const idNum = Number(licitacionId) || 0;
  const list = trpc.calendario.list.useQuery({ licitacionId: idNum }, { enabled: idNum > 0 });
  const cfg = trpc.calendario.configurar.useMutation({ onSuccess: () => list.refetch() });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Calendario jurídico"
        description="Ventanas obligatorias de actos del procedimiento. Cuando existen, restringen recepción, evaluación y adjudicación."
        breadcrumbs={[{ label: "Dependencia" }, { label: "Calendario jurídico" }]}
      />
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 px-4 py-3"><CardTitle className="text-sm font-semibold">Configurar ventana</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <div className="space-y-1"><Label className="text-xs">Licitación</Label><Input value={licitacionId} onChange={(e) => setLicitacionId(e.target.value)} className="w-28" /></div>
          <div className="space-y-1"><Label className="text-xs">Acto</Label>
            <select className="h-9 rounded border border-slate-200 px-2 text-sm" value={acto} onChange={(e) => setActo(e.target.value)}>
              {["RECEPCION","JUNTA_ACLARACIONES","APERTURA","EVALUACION","FALLO","ADJUDICACION"].map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Inicio</Label><Input type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Fin</Label><Input type="datetime-local" value={fin} onChange={(e) => setFin(e.target.value)} /></div>
          <Button className="self-end" disabled={!idNum || !inicio || !fin || cfg.isPending}
            onClick={() => cfg.mutate({
              licitacionId: idNum, acto,
              ventanaInicio: new Date(inicio).toISOString(),
              ventanaFin: new Date(fin).toISOString(),
              obligatorio: true,
              motivo: "Configuración de calendario jurídico",
            })}>Guardar</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-500">
              <th className="p-3">Acto</th><th className="p-3">Inicio</th><th className="p-3">Fin</th><th className="p-3">Obligatorio</th>
            </tr></thead>
            <tbody>
              {(list.data ?? []).map((r: any) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="p-3 font-medium">{r.acto}</td>
                  <td className="p-3">{new Date(r.ventanaInicio).toLocaleString("es-MX")}</td>
                  <td className="p-3">{new Date(r.ventanaFin).toLocaleString("es-MX")}</td>
                  <td className="p-3">{r.obligatorio ? "Sí" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
