import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Garantias() {
  const [page] = useState(1);
  const [contratoId, setContratoId] = useState("");
  const [monto, setMonto] = useState("");
  const [instrumento, setInstrumento] = useState("");
  const [poliza, setPoliza] = useState("");
  const [docId, setDocId] = useState("");
  const list = trpc.garantias.list.useQuery({ page, pageSize: 20 });
  const requerir = trpc.garantias.requerir.useMutation({ onSuccess: () => list.refetch() });
  const presentar = trpc.garantias.presentar.useMutation({ onSuccess: () => list.refetch() });
  const activar = trpc.garantias.activar.useMutation({ onSuccess: () => list.refetch() });
  const liberar = trpc.garantias.liberar.useMutation({ onSuccess: () => list.refetch() });
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Garantías</h2>
      <p className="text-sm text-slate-400">Recibir/presentar (proveedor o intake) ≠ validar/activar (convocante). Documento GARANTIA APROBADO requerido antes de VIGENTE.</p>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Requerir garantía</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Input placeholder="Contrato ID" value={contratoId} onChange={e => setContratoId(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[8rem]" />
          <Input placeholder="Monto" value={monto} onChange={e => setMonto(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[10rem]" />
          <Button className="bg-amber-600" disabled={!contratoId || !monto || requerir.isPending}
            onClick={() => requerir.mutate({ contratoId: Number(contratoId), tipo: "CUMPLIMIENTO", monto, motivo: "Requerimiento de garantía de cumplimiento" })}>Requerir</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Datos de presentación</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Input placeholder="Instrumento" value={instrumento} onChange={e => setInstrumento(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Input placeholder="Núm. póliza" value={poliza} onChange={e => setPoliza(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Input placeholder="Documento GARANTIA ID" value={docId} onChange={e => setDocId(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[10rem]" />
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">ID</th>
              <th className="p-3 text-left text-xs text-slate-400">Tipo</th>
              <th className="p-3 text-left text-xs text-slate-400">Monto</th>
              <th className="p-3 text-left text-xs text-slate-400">Estado</th>
              <th className="p-3 text-right text-xs text-slate-400">Acción</th>
            </tr></thead>
            <tbody>
              {(list.data?.items ?? []).map((g: any) => (
                <tr key={g.id} className="border-b border-slate-800">
                  <td className="p-3 text-sm text-white">{g.id}</td>
                  <td className="p-3 text-sm text-slate-300">{g.tipo}</td>
                  <td className="p-3 text-sm text-slate-300">${g.monto}</td>
                  <td className="p-3 text-xs text-slate-300">{g.estado}</td>
                  <td className="p-3 text-right space-x-2">
                    {g.estado === "REQUERIDA" && <Button size="sm" disabled={!instrumento || !poliza || !docId}
                      onClick={() => presentar.mutate({
                        id: g.id, instrumento, numeroPoliza: poliza, documentoId: Number(docId),
                        fechaInicio: new Date().toISOString().slice(0,10),
                        fechaVencimiento: new Date(Date.now() + 365*864e5).toISOString().slice(0,10),
                        motivo: "Presentación / intake de garantía",
                      })}>Presentar</Button>}
                    {g.estado === "PRESENTADA" && <Button size="sm" onClick={() => activar.mutate({ id: g.id, motivo: "Validar y activar garantía" })}>Activar</Button>}
                    {g.estado === "VIGENTE" && <Button size="sm" variant="outline" onClick={() => liberar.mutate({ id: g.id, motivo: "Liberar garantía" })}>Liberar</Button>}
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
