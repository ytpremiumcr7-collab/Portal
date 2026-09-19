import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";
import { EmptyState } from "@/components/ares/EmptyState";
import { SplitSquareVertical } from "lucide-react";

export default function SoD() {
  const [lic, setLic] = useState("");
  const [userId, setUserId] = useState("");
  const [rol, setRol] = useState("evaluador_tecnico");
  const [override, setOverride] = useState(false);
  const [just, setJust] = useState("");
  const catalog = trpc.sod.rolesCatalog.useQuery();
  const incomp = trpc.sod.listIncompatibilidades.useQuery();
  const asig = trpc.sod.listAsignaciones.useQuery({ licitacionId: Number(lic) || 0 }, { enabled: !!Number(lic) });
  const pending = trpc.sod.listAssignmentRequests.useQuery({ status: "PENDING", licitacionId: Number(lic) || undefined });
  const requestAsignar = trpc.sod.requestAsignar.useMutation({ onSuccess: () => { asig.refetch(); pending.refetch(); } });
  const approveAsignar = trpc.sod.approveAsignar.useMutation({ onSuccess: () => { asig.refetch(); pending.refetch(); } });
  const revocar = trpc.sod.revocar.useMutation({ onSuccess: () => asig.refetch() });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Segregación de funciones (SoD)"
        description="Asignación de roles por procedimiento con cuatro ojos: solicitar → aprobar (segundo actor)."
        breadcrumbs={[{ label: "Sistema", href: "/usuarios" }, { label: "SoD" }]}
      />

      <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
        <CardHeader className="border-b border-slate-800 px-4 py-3"><CardTitle className="text-sm text-slate-100">Incompatibilidades</CardTitle></CardHeader>
        <CardContent className="space-y-2 p-4 text-sm text-slate-300">
          {(incomp.data?.capabilities ?? []).map((r: any) => (
            <div key={r.id} className="rounded border border-slate-800 px-3 py-2">
              <span className="font-mono text-xs text-amber-500/90">{r.capabilityA}</span>
              <span className="mx-2 text-slate-600">↔</span>
              <span className="font-mono text-xs text-amber-500/90">{r.capabilityB}</span>
            </div>
          ))}
          {(catalog.data?.defaultIncompatibilidades ?? []).map((r: any, i: number) => (
            <div key={i} className="text-xs text-slate-500">rol {r.a} ↔ {r.b}</div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
        <CardHeader className="border-b border-slate-800 px-4 py-3"><CardTitle className="text-sm text-slate-100">Solicitar asignación (requiere segundo aprobador)</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5"><Label>Licitación ID</Label><Input value={lic} onChange={(e) => setLic(e.target.value)} className="max-w-[8rem]" /></div>
          <div className="space-y-1.5"><Label>Usuario ID</Label><Input value={userId} onChange={(e) => setUserId(e.target.value)} className="max-w-[8rem]" /></div>
          <div className="space-y-1.5"><Label>Rol</Label><Input value={rol} onChange={(e) => setRol(e.target.value)} className="max-w-xs" /></div>
          <label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />Override SoD</label>
          {override && <Input value={just} onChange={(e) => setJust(e.target.value)} placeholder="Justificación ≥10" className="min-w-[14rem]" />}
          <Button disabled={!lic || !userId || !rol || requestAsignar.isPending || (override && just.length < 10)}
            onClick={() => requestAsignar.mutate({ licitacionId: Number(lic), userId: Number(userId), rol, overrideSod: override, justificacionOverride: override ? just : undefined, motivo: "Solicitud de asignación SoD" })}>
            Solicitar asignación
          </Button>
        </CardContent>
      </Card>

      <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
        <CardHeader className="border-b border-slate-800 px-4 py-3"><CardTitle className="text-sm text-slate-100">Solicitudes pendientes</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!(pending.data ?? []).length ? <EmptyState title="Sin solicitudes pendientes" description="Las solicitudes de asignación aparecen aquí para aprobación por un segundo actor." icon={<SplitSquareVertical className="h-5 w-5" />} /> : (
            <table className="ares-table w-full"><thead><tr><th>ID</th><th>Lic.</th><th>Usuario</th><th>Rol</th><th></th></tr></thead>
              <tbody>{(pending.data ?? []).map((r: any) => (
                <tr key={r.id}><td>{r.id}</td><td>{r.licitacionId}</td><td>{r.userId}</td><td className="font-mono text-xs">{r.rol}</td>
                  <td className="text-right"><Button size="sm" disabled={approveAsignar.isPending} onClick={() => approveAsignar.mutate({ id: r.id, motivo: "Aprobación cuatro ojos" })}>Aprobar</Button></td></tr>
              ))}</tbody></table>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
        <CardHeader className="border-b border-slate-800 px-4 py-3"><CardTitle className="text-sm text-slate-100">Asignaciones vigentes</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!Number(lic) ? <EmptyState title="Indique licitacion ID" description="Capture el procedimiento para listar asignaciones." icon={<SplitSquareVertical className="h-5 w-5" />} /> :
          !(asig.data ?? []).length ? <EmptyState title="Sin asignaciones" description="Aún no hay roles asignados." icon={<SplitSquareVertical className="h-5 w-5" />} /> : (
            <table className="ares-table w-full"><thead><tr><th>ID</th><th>Usuario</th><th>Rol</th><th>Override</th><th></th></tr></thead>
              <tbody>{(asig.data ?? []).map((row: any) => (
                <tr key={row.id}><td>{row.id}</td><td>{row.userId}</td><td className="font-mono text-xs">{row.rol}</td>
                  <td>{row.overrideSod ? <StatusBadge label="Override" tone="warning" /> : <StatusBadge label="Normal" tone="neutral" />}</td>
                  <td className="text-right"><Button size="sm" variant="outline" onClick={() => revocar.mutate({ id: row.id, motivo: "Revocación de rol" })}>Revocar</Button></td></tr>
              ))}</tbody></table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
