import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ares/PageHeader";

export default function SmtpSettings() {
  const settings = trpc.smtp.getSettings.useQuery();
  const outbox = trpc.smtp.listOutbox.useQuery({});
  const upsert = trpc.smtp.upsertSettings.useMutation({ onSuccess: () => settings.refetch() });
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [fromAddress, setFrom] = useState("");
  const [fromName, setFromName] = useState("");
  const [username, setUsername] = useState("");
  useEffect(() => {
    if (settings.data) {
      setHost(settings.data.host ?? "");
      setPort(String(settings.data.port ?? 587));
      setFrom(settings.data.fromAddress ?? "");
      setFromName(settings.data.fromName ?? "");
      setUsername(settings.data.username ?? "");
    }
  }, [settings.data]);

  return (
    <div className="space-y-5">
      <PageHeader title="SMTP / outbox" description="Configuración SMTP del tenant y cola de entrega (admin). Secretos de contraseña se gestionan por variables de entorno del worker." breadcrumbs={[{ label: "Sistema", href: "/usuarios" }, { label: "SMTP" }]} />
      <Card className="border-slate-700/80 bg-slate-900/70"><CardHeader><CardTitle className="text-sm">Estado: {settings.data?.status ?? "…"}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
          <div><Label>Host</Label><Input value={host} onChange={(e) => setHost(e.target.value)} /></div>
          <div><Label>Puerto</Label><Input value={port} onChange={(e) => setPort(e.target.value)} /></div>
          <div><Label>From</Label><Input value={fromAddress} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>From name</Label><Input value={fromName} onChange={(e) => setFromName(e.target.value)} /></div>
          <div><Label>Username</Label><Input value={username} onChange={(e) => setUsername(e.target.value)} /></div>
          <div className="flex items-end"><Button disabled={upsert.isPending} onClick={() => upsert.mutate({ host: host || null, port: port ? Number(port) : null, secure: Number(port) === 465, username: username || null, fromAddress: fromAddress || null, fromName: fromName || null, status: "CONFIGURED", motivo: "Actualización SMTP tenant" })}>Guardar</Button></div>
          {settings.data?.lastError && <p className="sm:col-span-2 text-xs text-red-400">{settings.data.lastError}</p>}
        </CardContent></Card>
      <Card className="border-slate-700/80 bg-slate-900/70"><CardHeader><CardTitle className="text-sm">Outbox reciente</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-800 text-left text-xs text-slate-500"><th className="p-3">ID</th><th>Tipo</th><th>Estado</th><th>Intentos</th></tr></thead>
          <tbody>{(outbox.data?.items ?? []).map((r: any) => (
            <tr key={r.id} className="border-b border-slate-800"><td className="p-3">{r.id}</td><td>{r.eventType ?? r.aggregateType}</td><td>{r.status}</td><td>{r.attempts ?? "—"}</td></tr>
          ))}</tbody></table></CardContent></Card>
    </div>
  );
}
