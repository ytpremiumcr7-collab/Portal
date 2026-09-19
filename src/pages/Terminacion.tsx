import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";

export default function Terminacion() {
  const [licitacionId, setLicitacionId] = useState("");
  const [tipo, setTipo] = useState<"CANCELACION" | "DESIERTO">("CANCELACION");
  const [causa, setCausa] = useState("");
  const [fundamento, setFundamento] = useState("");
  const idNum = Number(licitacionId) || 0;
  const list = trpc.terminacion.list.useQuery({ licitacionId: idNum }, { enabled: idNum > 0 });
  const crear = trpc.terminacion.crear.useMutation({ onSuccess: () => list.refetch() });
  const publicar = trpc.terminacion.publicar.useMutation({ onSuccess: () => list.refetch() });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cancelación / desierto"
        description="Actos formales de terminación del procedimiento con causa, fundamento y publicación."
        breadcrumbs={[{ label: "Dependencia" }, { label: "Cancelación / desierto" }]}
      />
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 px-4 py-3"><CardTitle className="text-sm font-semibold">Nuevo acto</CardTitle></CardHeader>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
          <div className="space-y-1"><Label className="text-xs">Licitación</Label><Input value={licitacionId} onChange={(e) => setLicitacionId(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Tipo</Label>
            <select className="h-9 w-full rounded border border-slate-200 px-2 text-sm" value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
              <option value="CANCELACION">Cancelación</option>
              <option value="DESIERTO">Desierto</option>
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Causa</Label><Input value={causa} onChange={(e) => setCausa(e.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Fundamento</Label><Input value={fundamento} onChange={(e) => setFundamento(e.target.value)} /></div>
          <Button className="w-fit sm:col-span-2" disabled={!idNum || causa.length < 10 || fundamento.length < 10 || crear.isPending}
            onClick={() => crear.mutate({ licitacionId: idNum, tipo, causa, fundamento, motivo: `Alta de acto de ${tipo.toLowerCase()}` })}>
            Crear borrador
          </Button>
        </CardContent>
      </Card>
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-500">
              <th className="p-3">ID</th><th className="p-3">Tipo</th><th className="p-3">Estado</th><th className="p-3">Causa</th><th className="p-3 text-right">Acción</th>
            </tr></thead>
            <tbody>
              {(list.data ?? []).map((a: any) => (
                <tr key={a.id} className="border-b border-slate-100">
                  <td className="p-3">{a.id}</td>
                  <td className="p-3">{a.tipo}</td>
                  <td className="p-3"><StatusBadge status={a.estado} /></td>
                  <td className="max-w-xs truncate p-3">{a.causa}</td>
                  <td className="p-3 text-right">
                    {a.estado === "BORRADOR" && (
                      <Button size="sm" onClick={() => publicar.mutate({ id: a.id, motivo: "Publicación del acto de terminación" })}>Publicar</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
