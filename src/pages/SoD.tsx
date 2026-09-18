import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function SoD() {
  const [lic, setLic] = useState("");
  const [userId, setUserId] = useState("");
  const [rol, setRol] = useState("evaluador_tecnico");
  const [override, setOverride] = useState(false);
  const [just, setJust] = useState("");
  const catalog = trpc.sod.rolesCatalog.useQuery();
  const incomp = trpc.sod.listIncompatibilidades.useQuery();
  const asig = trpc.sod.listAsignaciones.useQuery({ licitacionId: Number(lic) || 0 }, { enabled: !!Number(lic) });
  const asignar = trpc.sod.asignar.useMutation({ onSuccess: () => asig.refetch() });
  const revocar = trpc.sod.revocar.useMutation({ onSuccess: () => asig.refetch() });
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Segregación de funciones (SoD)</h2>
      <p className="text-sm text-slate-400">Asignaciones por procedimiento e incompatibilidades. Override admin con justificación en expediente.</p>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Incompatibilidades</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-300">
          {(incomp.data?.capabilities ?? []).map((r: any) => (
            <div key={r.id}>{r.capabilityA} ↔ {r.capabilityB} — {r.motivo}</div>
          ))}
          {(incomp.data?.roles ?? []).map((r: any, i: number) => (
            <div key={i} className="text-slate-400">rol {r.a} ↔ {r.b}</div>
          ))}
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Asignar rol a procedimiento</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3 items-center">
          <Input placeholder="Licitación ID" value={lic} onChange={e => setLic(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[8rem]" />
          <Input placeholder="User ID" value={userId} onChange={e => setUserId(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[8rem]" />
          <Input placeholder="Rol" value={rol} onChange={e => setRol(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <label className="text-xs text-slate-400 flex items-center gap-2">
            <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} /> Override SoD
          </label>
          {override && <Input placeholder="Justificación override (≥10)" value={just} onChange={e => setJust(e.target.value)} className="bg-slate-700 border-slate-600 text-white flex-1 min-w-[14rem]" />}
          <Button className="bg-amber-600" disabled={!lic || !userId || !rol || asignar.isPending}
            onClick={() => asignar.mutate({
              licitacionId: Number(lic), userId: Number(userId), rol,
              overrideSod: override, justificacionOverride: override ? just : undefined,
              motivo: "Asignación de rol de procedimiento",
            })}>Asignar</Button>
        </CardContent>
        <CardContent className="text-xs text-slate-500">Roles: {(catalog.data?.roles ?? []).join(", ")}</CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Asignaciones del procedimiento</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">ID</th>
              <th className="p-3 text-left text-xs text-slate-400">User</th>
              <th className="p-3 text-left text-xs text-slate-400">Rol</th>
              <th className="p-3 text-left text-xs text-slate-400">Override</th>
              <th className="p-3 text-right text-xs text-slate-400">Acción</th>
            </tr></thead>
            <tbody>
              {(asig.data ?? []).map((row: any) => (
                <tr key={row.id} className="border-b border-slate-800">
                  <td className="p-3 text-sm text-white">{row.id}</td>
                  <td className="p-3 text-sm text-slate-300">{row.userId}</td>
                  <td className="p-3 text-xs text-slate-300">{row.rol}</td>
                  <td className="p-3 text-xs text-slate-300">{row.overrideSod ? "sí" : "no"}</td>
                  <td className="p-3 text-right"><Button size="sm" variant="outline" onClick={() => revocar.mutate({ id: row.id, motivo: "Revocación de asignación SoD" })}>Revocar</Button></td>
                </tr>
              ))}
              {!asig.data?.length && <tr><td colSpan={5} className="p-4 text-slate-500 text-sm">Indique licitación o sin asignaciones</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
