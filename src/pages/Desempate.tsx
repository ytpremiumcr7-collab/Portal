import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ares/PageHeader";
import { useAuth } from "@/hooks/useAuth";
import { useCapability } from "@/hooks/useCapability";

export default function Desempate() {
  useAuth({ redirectOnUnauthenticated: true });
  const { allowed: canEmitir } = useCapability("emitir_desempate");
  const [lic, setLic] = useState("");
  const [semilla, setSemilla] = useState("");
  const [orden, setOrden] = useState("1:101,2:102"); // orden:participacionId
  const [evidenciaDocId, setEvidenciaDocId] = useState("");
  const [motivo, setMotivo] = useState("Acto de desempate");
  const acto = trpc.desempate.getByLicitacion.useQuery({ licitacionId: Number(lic) || 0 }, { enabled: !!Number(lic) });
  const emitir = trpc.desempate.emitir.useMutation({ onSuccess: () => acto.refetch() });
  const registrar = trpc.desempate.registrarResultado.useMutation({ onSuccess: () => acto.refetch() });

  const parseOrden = () => orden.split(",").map((p) => {
    const [o, id] = p.trim().split(":").map(Number);
    return { participacionId: id, orden: o };
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Desempate / sorteo documentado" description="Emitir acto y registrar resultado con evidencia vinculada al procedimiento." breadcrumbs={[{ label: "Procedimiento", href: "/licitaciones" }, { label: "Desempate" }]} />
      <Card className="border-slate-700/80 bg-slate-900/70"><CardContent className="flex flex-wrap gap-3 p-4">
        <div><Label>Licitación ID</Label><Input value={lic} onChange={(e) => setLic(e.target.value)} className="max-w-[8rem]" /></div>
        <div><Label>Semilla</Label><Input value={semilla} onChange={(e) => setSemilla(e.target.value)} /></div>
        <div><Label>Motivo</Label><Input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="min-w-[14rem]" /></div>
        <Button className="self-end" disabled={!canEmitir || !lic || emitir.isPending} onClick={() => emitir.mutate({ licitacionId: Number(lic), metodo: "SORTEO_DOCUMENTADO", semilla: semilla || undefined, motivo })}>Emitir acto</Button>
      </CardContent></Card>
      {acto.data && (
        <Card className="border-slate-700/80 bg-slate-900/70"><CardHeader><CardTitle className="text-sm">Acto #{acto.data.id} — {acto.data.estado}</CardTitle></CardHeader>
          <CardContent className="space-y-3 p-4 text-sm text-slate-300">
            <pre className="overflow-auto rounded bg-slate-950/60 p-3 text-xs">{JSON.stringify(acto.data, null, 2)}</pre>
            {["EMITIDO", "BORRADOR"].includes(acto.data.estado) && (
              <div className="flex flex-wrap gap-3">
                <div><Label>Orden (orden:participacionId,…)</Label><Input value={orden} onChange={(e) => setOrden(e.target.value)} className="min-w-[16rem]" /></div>
                <div><Label>Evidencia doc ID</Label><Input value={evidenciaDocId} onChange={(e) => setEvidenciaDocId(e.target.value)} className="max-w-[8rem]" /></div>
                <Button className="self-end" disabled={registrar.isPending} onClick={() => registrar.mutate({ licitacionId: Number(lic), orden: parseOrden(), evidenciaDocId: evidenciaDocId ? Number(evidenciaDocId) : undefined, motivo })}>Registrar resultado</Button>
              </div>
            )}
          </CardContent></Card>
      )}
    </div>
  );
}
