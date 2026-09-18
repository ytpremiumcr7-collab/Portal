import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Inconformidades() {
  const [page] = useState(1);
  const [lic, setLic] = useState("");
  const [nombre, setNombre] = useState("");
  const [acto, setActo] = useState("");
  const [args, setArgs] = useState("");
  const [folio, setFolio] = useState("");
  const list = trpc.inconformidades.list.useQuery({ page, pageSize: 20 });
  const presentar = trpc.inconformidades.presentar.useMutation({ onSuccess: () => list.refetch() });
  const trans = trpc.inconformidades.transicionar.useMutation({ onSuccess: () => list.refetch() });
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Inconformidades</h2>
      <p className="text-sm text-slate-400">Promovente presenta; resolver_inconformidad tramita (SoD: promovente ≠ resolver).</p>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Presentar inconformidad</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Input placeholder="Licitación ID" value={lic} onChange={e => setLic(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-[8rem]" />
          <Input placeholder="Folio" value={folio} onChange={e => setFolio(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Input placeholder="Promovente" value={nombre} onChange={e => setNombre(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Input placeholder="Acto impugnado" value={acto} onChange={e => setActo(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-sm" />
          <Input placeholder="Argumentos (≥20)" value={args} onChange={e => setArgs(e.target.value)} className="bg-slate-700 border-slate-600 text-white flex-1 min-w-[14rem]" />
          <Button className="bg-amber-600" disabled={!lic || !folio || !nombre || !acto || presentar.isPending}
            onClick={() => presentar.mutate({
              licitacionId: Number(lic), folio, promoventeNombre: nombre, actoImpugnado: acto,
              argumentos: args.length >= 20 ? args : (args + " — argumentos de la inconformidad presentada"),
              motivo: "Presentación de inconformidad",
            })}>Presentar</Button>
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
              {(list.data?.items ?? []).map((row: any) => (
                <tr key={row.id} className="border-b border-slate-800">
                  <td className="p-3 text-sm text-white">{row.id}</td>
                  <td className="p-3 text-sm text-slate-300">{row.folio}</td>
                  <td className="p-3 text-xs text-slate-300">{row.estado}</td>
                  <td className="p-3 text-right space-x-2">
                    {row.estado === "PRESENTADA" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "ADMITIDA", motivo: "Admitir" })}>Admitir</Button>}
                    {row.estado === "ADMITIDA" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "EN_TRAMITE", motivo: "Tramitar" })}>Tramitar</Button>}
                    {row.estado === "EN_TRAMITE" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "RESUELTA", motivo: "Resolver", resolucion: "Se resuelve la inconformidad conforme a derecho" })}>Resolver</Button>}
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
