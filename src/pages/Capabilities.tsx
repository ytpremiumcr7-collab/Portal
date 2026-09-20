import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ares/PageHeader";
import { useAuth } from "@/hooks/useAuth";
import { useCapability } from "@/hooks/useCapability";

export default function Capabilities() {
  useAuth({ redirectOnUnauthenticated: true });
  const { allowed: canAudit } = useCapability("auditar");
  const { isAdmin } = useCapability("auditar");
  const canManage = canAudit || isAdmin;
  const [userId, setUserId] = useState("");
  const [cap, setCap] = useState("evaluar_tecnico");
  const [motivo, setMotivo] = useState("Solicitud de capacidad");
  const catalog = trpc.capabilities.catalog.useQuery();
  const forUser = trpc.capabilities.listForUser.useQuery({ userId: Number(userId) || 0 }, { enabled: !!Number(userId) });
  const pending = trpc.capabilities.listGrantRequests.useQuery({ status: "PENDING" });
  const requestGrant = trpc.capabilities.requestGrant.useMutation({ onSuccess: () => pending.refetch() });
  const approveGrant = trpc.capabilities.approveGrant.useMutation({ onSuccess: () => { pending.refetch(); forUser.refetch(); } });

  const overrides = forUser.data?.overrides ?? [];
  const effective = forUser.data?.effective ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Capacidades" description="Altas de capacidades con cuatro ojos (requestGrant → approveGrant)." breadcrumbs={[{ label: "Sistema", href: "/usuarios" }, { label: "Capacidades" }]} />
      <Card className="border-slate-200 bg-white shadow-sm"><CardHeader><CardTitle className="text-sm">Catálogo</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2 p-4 text-xs font-mono text-slate-600">{(catalog.data?.capabilities ?? []).map((c: string) => <span key={c} className="rounded border border-slate-700 px-2 py-1">{c}</span>)}</CardContent></Card>
      <Card className="border-slate-200 bg-white shadow-sm"><CardHeader><CardTitle className="text-sm">Solicitar grant</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <div><Label>Usuario ID</Label><Input value={userId} onChange={(e) => setUserId(e.target.value)} className="max-w-[8rem]" /></div>
          <div><Label>Capacidad</Label><Input value={cap} onChange={(e) => setCap(e.target.value)} className="max-w-xs" /></div>
          <div><Label>Motivo</Label><Input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="min-w-[14rem]" /></div>
          <Button className="self-end" disabled={!canManage || !userId || !cap || requestGrant.isPending} onClick={() => requestGrant.mutate({ userId: Number(userId), capability: cap as any, motivo })}>Solicitar</Button>
        </CardContent></Card>
      <Card className="border-slate-200 bg-white shadow-sm"><CardHeader><CardTitle className="text-sm">Pendientes de aprobación</CardTitle></CardHeader>
        <CardContent className="p-0"><table className="w-full text-sm"><thead><tr className="border-b border-slate-200 text-left text-xs text-slate-500"><th className="p-3">ID</th><th>Usuario</th><th>Capacidad</th><th></th></tr></thead>
          <tbody>{(pending.data ?? []).map((r: any) => (
            <tr key={r.id} className="border-b border-slate-200"><td className="p-3">{r.id}</td><td>{r.userId}</td><td className="font-mono text-xs">{r.capability}</td>
              <td className="p-3 text-right"><Button size="sm" disabled={!canManage} onClick={() => approveGrant.mutate({ id: r.id, motivo: "Aprobación cuatro ojos" })}>Aprobar</Button></td></tr>
          ))}</tbody></table></CardContent></Card>
      {!!Number(userId) && (
        <Card className="border-slate-200 bg-white shadow-sm"><CardHeader><CardTitle className="text-sm">Grants del usuario {userId}</CardTitle></CardHeader>
          <CardContent className="p-4 text-xs font-mono text-slate-700 space-y-2">
            <div className="text-slate-500">Overrides</div>
            {overrides.map((g: any) => <div key={g.id}>{g.capability} {g.granted ? "✓" : "✗"}</div>)}
            <div className="pt-2 text-slate-500">Efectivas</div>
            {effective.map((c: string) => <div key={c}>{c}</div>)}
          </CardContent></Card>
      )}
    </div>
  );
}
