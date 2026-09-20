import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";

export default function InvestigacionMercado() {
  const [page, setPage] = useState(1);
  const [folio, setFolio] = useState("");
  const [objeto, setObjeto] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [razonExt, setRazonExt] = useState("");
  const [cotProvId, setCotProvId] = useState("");
  const [cotMonto, setCotMonto] = useState("");
  const [cotId, setCotId] = useState("");
  const [resultado, setResultado] = useState("");
  const [conclusion, setConclusion] = useState("");
  const list = trpc.investigacionMercado.list.useQuery({ page, pageSize: 20 });
  const detail = trpc.investigacionMercado.getById.useQuery({ id: selectedId! }, { enabled: !!selectedId });
  const comparativo = trpc.investigacionMercado.comparativo.useQuery({ investigacionId: selectedId! }, { enabled: !!selectedId });
  const crear = trpc.investigacionMercado.crear.useMutation({ onSuccess: () => list.refetch() });
  const trans = trpc.investigacionMercado.transicionar.useMutation({ onSuccess: () => { list.refetch(); detail.refetch(); } });
  const consultar = trpc.investigacionMercado.consultarProveedor.useMutation({ onSuccess: () => detail.refetch() });
  const registrarCot = trpc.investigacionMercado.registrarCotizacion.useMutation({ onSuccess: () => { detail.refetch(); comparativo.refetch(); } });
  const validar = trpc.investigacionMercado.validarCotizacion.useMutation({ onSuccess: () => { detail.refetch(); comparativo.refetch(); } });
  const descartar = trpc.investigacionMercado.descartarCotizacion.useMutation({ onSuccess: () => { detail.refetch(); comparativo.refetch(); } });

  return (
    <div className="space-y-5">
      <PageHeader title="Investigación de mercado" description="Cotizaciones, validación/descarte, comparativo y conclusión — distinta de participación/oferta." breadcrumbs={[{ label: "Planeación", href: "/planeacion" }, { label: "Investigación de mercado" }]} />
      <Card className="border-slate-700/80 bg-slate-900/70"><CardHeader><CardTitle className="text-sm">Abrir investigación</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Input placeholder="Folio" value={folio} onChange={(e) => setFolio(e.target.value)} className="max-w-xs" />
          <Input placeholder="Objeto (≥10)" value={objeto} onChange={(e) => setObjeto(e.target.value)} className="min-w-[14rem] flex-1" />
          <Button disabled={!folio || objeto.length < 10 || crear.isPending} onClick={() => crear.mutate({ folio, objeto, motivo: "Apertura investigación de mercado" })}>Crear</Button>
        </CardContent></Card>
      <Card className="border-slate-700/80 bg-slate-900/70"><CardContent className="p-0">
        <table className="w-full text-sm"><thead><tr className="border-b border-slate-800 text-left text-xs text-slate-500"><th className="p-3">ID</th><th>Folio</th><th>Estado</th><th /></tr></thead>
          <tbody>{(list.data?.items ?? []).map((row: any) => (
            <tr key={row.id} className="border-b border-slate-800">
              <td className="p-3"><button type="button" className="text-amber-400 underline" onClick={() => setSelectedId(row.id)}>{row.id}</button></td>
              <td>{row.folio}</td><td><StatusBadge status={row.estado} /></td>
              <td className="space-x-1 p-3 text-right">
                {row.estado === "BORRADOR" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "EN_CONSULTA", motivo: "Abrir consulta" })}>Consultar</Button>}
                {row.estado === "EN_CONSULTA" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "CERRADA", motivo: "Cerrar consulta" })}>Cerrar</Button>}
                {row.estado === "CERRADA" && (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <Input placeholder="Resultado" value={resultado} onChange={(e) => setResultado(e.target.value)} className="max-w-[10rem] h-8" />
                    <Input placeholder="Conclusión" value={conclusion} onChange={(e) => setConclusion(e.target.value)} className="max-w-[12rem] h-8" />
                    <Button size="sm" disabled={!resultado.trim() || !conclusion.trim()} onClick={() => trans.mutate({ id: row.id, to: "CONCLUIDA", resultado, conclusion, motivo: "Concluir" })}>Concluir</Button>
                  </span>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </CardContent></Card>

      {selectedId && (
        <>
          <Card className="border-slate-700/80 bg-slate-900/70"><CardHeader><CardTitle className="text-sm">Detalle #{selectedId}</CardTitle></CardHeader>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap gap-3">
                <div><Label>Razón social externa</Label><Input value={razonExt} onChange={(e) => setRazonExt(e.target.value)} /></div>
                <Button className="self-end" disabled={consultar.isPending} onClick={() => consultar.mutate({ investigacionId: selectedId, razonSocialExterna: razonExt || "Proveedor externo", fuente: "Consulta directa", motivo: "Registrar consultado" })}>Consultar proveedor</Button>
              </div>
              <div className="flex flex-wrap gap-3">
                <Input placeholder="Proveedor consultado ID" value={cotProvId} onChange={(e) => setCotProvId(e.target.value)} className="max-w-[10rem]" />
                <Input placeholder="Monto" value={cotMonto} onChange={(e) => setCotMonto(e.target.value)} className="max-w-[8rem]" />
                <Button disabled={registrarCot.isPending} onClick={() => registrarCot.mutate({ investigacionId: selectedId, proveedorConsultadoId: Number(cotProvId), monto: cotMonto, motivo: "Registrar cotización" })}>Registrar cotización</Button>
              </div>
              <div className="flex flex-wrap gap-3">
                <Input placeholder="Cotización ID" value={cotId} onChange={(e) => setCotId(e.target.value)} className="max-w-[8rem]" />
                <Button size="sm" onClick={() => validar.mutate({ id: Number(cotId), motivo: "Validar cotización" })}>Validar</Button>
                <Button size="sm" variant="outline" onClick={() => descartar.mutate({ id: Number(cotId), motivo: "Descartar cotización" })}>Descartar</Button>
              </div>
              <pre className="overflow-auto rounded bg-slate-950/50 p-3 text-xs text-slate-400">{JSON.stringify(detail.data?.cotizaciones ?? [], null, 2)}</pre>
            </CardContent></Card>
          <Card className="border-slate-700/80 bg-slate-900/70"><CardHeader><CardTitle className="text-sm">Comparativo (sólo VALIDADA)</CardTitle></CardHeader>
            <CardContent className="p-4 text-sm text-slate-300">
              <p>n={comparativo.data?.count ?? 0} · min={String(comparativo.data?.min ?? "—")} · max={String(comparativo.data?.max ?? "—")} · avg={String(comparativo.data?.avg ?? "—")}</p>
            </CardContent></Card>
        </>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
        <Button variant="outline" onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}
