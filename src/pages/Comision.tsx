import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ares/PageHeader";

export default function Comision() {
  const [licitacionId, setLicitacionId] = useState("");
  const [userId, setUserId] = useState("");
  const [rol, setRol] = useState("VOCAL");
  const [miembroId, setMiembroId] = useState("");
  const [desc, setDesc] = useState("");
  const [conflicto, setConflicto] = useState(false);
  const [recusado, setRecusado] = useState(false);
  const idNum = Number(licitacionId) || 0;
  const list = trpc.comision.list.useQuery({ licitacionId: idNum }, { enabled: idNum > 0 });
  const coi = trpc.comision.listCoi.useQuery({ licitacionId: idNum }, { enabled: idNum > 0 });
  const designar = trpc.comision.designar.useMutation({ onSuccess: () => list.refetch() });
  const declarar = trpc.comision.declararCoi.useMutation({ onSuccess: () => coi.refetch() });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Comisión evaluadora y COI"
        description="Designación de integrantes y declaraciones de conflicto de interés. La evaluación se bloquea si hay COI sin recusación."
        breadcrumbs={[{ label: "Dependencia" }, { label: "Comisión / COI" }]}
      />
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 px-4 py-3"><CardTitle className="text-sm font-semibold">Designar integrante</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <div className="space-y-1"><Label className="text-xs">Licitación</Label><Input value={licitacionId} onChange={(e) => setLicitacionId(e.target.value)} className="w-28" /></div>
          <div className="space-y-1"><Label className="text-xs">Usuario</Label><Input value={userId} onChange={(e) => setUserId(e.target.value)} className="w-28" /></div>
          <div className="space-y-1"><Label className="text-xs">Rol</Label>
            <select className="h-9 rounded border border-slate-200 px-2 text-sm" value={rol} onChange={(e) => setRol(e.target.value)}>
              {["PRESIDENTE","SECRETARIO","VOCAL_TECNICO","VOCAL_ECONOMICO","VOCAL"].map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <Button className="self-end" disabled={!idNum || !userId || designar.isPending}
            onClick={() => designar.mutate({ licitacionId: idNum, userId: Number(userId), rol: rol as any, motivo: "Designación a comisión evaluadora" })}>
            Designar
          </Button>
        </CardContent>
      </Card>
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 px-4 py-3"><CardTitle className="text-sm font-semibold">Integrantes</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-500">
              <th className="p-3">ID</th><th className="p-3">Usuario</th><th className="p-3">Rol</th><th className="p-3">Activa</th>
            </tr></thead>
            <tbody>
              {(list.data ?? []).map((m: any) => (
                <tr key={m.id} className="border-b border-slate-100">
                  <td className="p-3">{m.id}</td><td className="p-3">{m.userId}</td><td className="p-3">{m.rol}</td><td className="p-3">{m.activa ? "Sí" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 px-4 py-3"><CardTitle className="text-sm font-semibold">Declarar COI</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Input placeholder="ID miembro comisión" value={miembroId} onChange={(e) => setMiembroId(e.target.value)} className="w-40" />
          <Input placeholder="Descripción" value={desc} onChange={(e) => setDesc(e.target.value)} className="min-w-[16rem] flex-1" />
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={conflicto} onChange={(e) => setConflicto(e.target.checked)} /> Tiene conflicto</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={recusado} onChange={(e) => setRecusado(e.target.checked)} /> Recusado</label>
          <Button disabled={!idNum || !miembroId || desc.length < 5 || declarar.isPending}
            onClick={() => declarar.mutate({
              licitacionId: idNum, comisionMiembroId: Number(miembroId),
              tieneConflicto: conflicto, descripcion: desc, recusado, motivo: "Declaración de conflicto de interés",
            })}>Registrar declaración</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 px-4 py-3"><CardTitle className="text-sm font-semibold">Declaraciones COI</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-500">
              <th className="p-3">ID</th><th className="p-3">Miembro</th><th className="p-3">Conflicto</th><th className="p-3">Recusado</th><th className="p-3">Descripción</th>
            </tr></thead>
            <tbody>
              {(coi.data ?? []).map((c: any) => (
                <tr key={c.id} className="border-b border-slate-100">
                  <td className="p-3">{c.id}</td><td className="p-3">{c.comisionMiembroId}</td>
                  <td className="p-3">{c.tieneConflicto ? "Sí" : "No"}</td>
                  <td className="p-3">{c.recusado ? "Sí" : "No"}</td>
                  <td className="p-3">{c.descripcion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
