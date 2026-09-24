import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useCapability } from "@/hooks/useCapability";

export default function Contratos() {
  useAuth({ redirectOnUnauthenticated: true });
  const { allowed: canFormalizar } = useCapability("formalizar_contrato");
  const [page, setPage] = useState(1);
  const [awardId, setAwardId] = useState("");
  const [folio, setFolio] = useState("");
  const [docId, setDocId] = useState("");
  const [causa, setCausa] = useState("");
  const [resolucion, setResolucion] = useState("");
  const list = trpc.contratos.list.useQuery({ page, pageSize: 20 });
  const contractable = trpc.contratos.contractableAwards.useQuery();
  const crear = trpc.contratos.crear.useMutation({ onSuccess: async () => {
    setAwardId("");
    setFolio("");
    await Promise.all([list.refetch(), contractable.refetch()]);
  } });
  const formalizar = trpc.contratos.formalizar.useMutation({ onSuccess: () => list.refetch() });
  const vigente = trpc.contratos.ponerVigente.useMutation({ onSuccess: () => list.refetch() });
  const rescindir = trpc.contratos.rescindir.useMutation({ onSuccess: () => list.refetch() });
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Contratos</h2>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Crear contrato desde adjudicación publicada</CardTitle></CardHeader>
        <CardContent className="flex gap-3 flex-wrap">
          <Select value={awardId} onValueChange={setAwardId}>
            <SelectTrigger className="w-full max-w-xl bg-slate-700 border-slate-600 text-white"><SelectValue placeholder="Seleccione lote adjudicado sin contrato" /></SelectTrigger>
            <SelectContent>
              {(contractable.data ?? []).map((award) => (
                <SelectItem key={award.awardId} value={String(award.awardId)}>
                  {award.lotCode} · {award.lotTitle} · {award.proveedor} · ${award.amount}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder="Folio contrato" value={folio} onChange={e => setFolio(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Button className="bg-amber-600" disabled={!canFormalizar || !awardId || !folio || crear.isPending} onClick={() => crear.mutate({ awardId: Number(awardId), folio, motivo: "Creación contractual desde adjudicación publicada" })}>Crear</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Evidencia / rescisión</CardTitle></CardHeader>
        <CardContent className="flex gap-3 flex-wrap">
          <Input placeholder="Documento CONTRATO ID (formalizar)" value={docId} onChange={e => setDocId(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Input placeholder="Causa rescisión" value={causa} onChange={e => setCausa(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-sm" />
          <Input placeholder="Resolución rescisión" value={resolucion} onChange={e => setResolucion(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-sm" />
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">Folio</th>
              <th className="p-3 text-left text-xs text-slate-400">Lic.</th>
              <th className="p-3 text-left text-xs text-slate-400">Lote / award</th>
              <th className="p-3 text-left text-xs text-slate-400">Monto</th>
              <th className="p-3 text-left text-xs text-slate-400">Estado</th>
              <th className="p-3 text-right text-xs text-slate-400">Acción</th>
            </tr></thead>
            <tbody>
              {list.data?.items.map(c => (
                <tr key={c.id} className="border-b border-slate-800">
                  <td className="p-3 text-sm text-white">{c.folio}</td>
                  <td className="p-3 text-sm text-white">{c.licitacionId}</td>
                  <td className="p-3 text-sm text-white">
                    {c.lotCode ?? "Legacy"} / #{c.awardId ?? "—"}
                    {c.lotId && <><br /><a className="text-xs text-amber-400 underline" href={`/documentos?licitacionId=${c.licitacionId}&lotId=${c.lotId}&tipo=CONTRATO`}>Cargar evidencia contractual</a></>}
                  </td>
                  <td className="p-3 text-sm text-white">${c.monto}</td>
                  <td className="p-3 text-xs text-slate-300">{c.estado}</td>
                  <td className="p-3 text-right flex justify-end gap-2 flex-wrap">
                    {c.estado === "BORRADOR" && canFormalizar && <Button size="sm" disabled={!docId} onClick={() => formalizar.mutate({ id: c.id, fechaFirma: new Date().toISOString().slice(0, 10), documentoContratoId: Number(docId), motivo: "Firma del contrato" })}>Formalizar</Button>}
                    {c.estado === "FORMALIZADO" && canFormalizar && <Button size="sm" onClick={() => vigente.mutate({ id: c.id, motivo: "Inicio de vigencia" })}>Poner vigente</Button>}
                    {["FORMALIZADO","VIGENTE"].includes(c.estado) && canFormalizar && <Button size="sm" variant="outline" disabled={causa.length < 10 || resolucion.length < 10}
                      onClick={() => rescindir.mutate({ id: c.id, causa, resolucion, motivo: "Rescisión contractual" })}>Rescindir</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
        <Button variant="outline" disabled={!list.data || page >= list.data.pageCount} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}
