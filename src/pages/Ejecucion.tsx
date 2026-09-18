import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Ejecucion() {
  const [page] = useState(1);
  const [contratoId, setContratoId] = useState("");
  const [folio, setFolio] = useState("");
  const [finMonto, setFinMonto] = useState("");
  const [finFolio, setFinFolio] = useState("");
  const mods = trpc.ejecucion.listModificaciones.useQuery({ page, pageSize: 20 });
  const iniciar = trpc.ejecucion.iniciarEjecucion.useMutation();
  const crearMod = trpc.ejecucion.crearModificacion.useMutation({ onSuccess: () => mods.refetch() });
  const transMod = trpc.ejecucion.transicionarModificacion.useMutation({ onSuccess: () => mods.refetch() });
  const transEjec = trpc.ejecucion.transicionarEjecucion.useMutation();
  const finiquito = trpc.ejecucion.emitirFiniquito.useMutation();
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Ejecución contractual</h2>
      <p className="text-sm text-slate-400">Modificaciones, avance, entregables y finiquito (con gates P1).</p>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Iniciar ejecución / finiquito</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Input placeholder="Contrato ID" value={contratoId} onChange={e => setContratoId(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[8rem]" />
          <Button disabled={!contratoId || iniciar.isPending} onClick={() => iniciar.mutate({ contratoId: Number(contratoId), fechaInicio: new Date().toISOString().slice(0,10), motivo: "Inicio de ejecución" })}>Iniciar</Button>
          <Button variant="outline" disabled={!contratoId} onClick={() => transEjec.mutate({ contratoId: Number(contratoId), to: "TERMINADA", motivo: "Terminar ejecución" })}>Terminar</Button>
          <Input placeholder="Folio finiquito" value={finFolio} onChange={e => setFinFolio(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Input placeholder="Monto final" value={finMonto} onChange={e => setFinMonto(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[10rem]" />
          <Button className="bg-amber-600" disabled={!contratoId || !finFolio || !finMonto || finiquito.isPending}
            onClick={() => finiquito.mutate({ contratoId: Number(contratoId), folio: finFolio, montoFinal: finMonto, motivo: "Emisión de finiquito" })}>Emitir finiquito</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Nueva modificación</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Input placeholder="Contrato ID" value={contratoId} onChange={e => setContratoId(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[8rem]" />
          <Input placeholder="Folio convenio" value={folio} onChange={e => setFolio(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Button disabled={!contratoId || !folio || crearMod.isPending}
            onClick={() => crearMod.mutate({ contratoId: Number(contratoId), tipo: "CONVENIO", folio, justificacion: "Modificación contractual justificada", motivo: "Alta modificación" })}>Crear</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardContent className="p-0">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <th className="p-3 text-left text-xs text-slate-400">ID</th>
              <th className="p-3 text-left text-xs text-slate-400">Folio</th>
              <th className="p-3 text-left text-xs text-slate-400">Estado</th>
              <th className="p-3 text-right text-xs text-slate-400">Acción</th>
            </tr></thead>
            <tbody>
              {(mods.data?.items ?? []).map((row: any) => (
                <tr key={row.id} className="border-b border-slate-800">
                  <td className="p-3 text-sm text-white">{row.id}</td>
                  <td className="p-3 text-sm text-slate-300">{row.folio}</td>
                  <td className="p-3 text-xs text-slate-300">{row.estado}</td>
                  <td className="p-3 text-right space-x-2">
                    {row.estado === "BORRADOR" && <Button size="sm" onClick={() => transMod.mutate({ id: row.id, to: "EN_REVISION", motivo: "Revisar" })}>Revisar</Button>}
                    {row.estado === "EN_REVISION" && <Button size="sm" onClick={() => transMod.mutate({ id: row.id, to: "APROBADA", motivo: "Aprobar" })}>Aprobar</Button>}
                    {row.estado === "APROBADA" && <Button size="sm" onClick={() => transMod.mutate({ id: row.id, to: "FORMALIZADA", motivo: "Formalizar" })}>Formalizar</Button>}
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
