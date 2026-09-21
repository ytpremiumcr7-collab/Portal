import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";

const MODALIDADES = [
  "LICITACION_PUBLICA",
  "INVITACION_RESTRINGIDA",
  "INVITACION_TRES",
  "ADJUDICACION_DIRECTA",
  "DIALOGO_COMPETITIVO",
  "ACUERDO_MARCO_ASIGNACION",
] as const;

export default function InvestigacionMercado() {
  const [page, setPage] = useState(1);
  const [folio, setFolio] = useState("");
  const [objeto, setObjeto] = useState("");
  const [licitacionId, setLicitacionId] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tipoFuente, setTipoFuente] = useState("PLATAFORMA_HISTORICA");
  const [descFuente, setDescFuente] = useState("");
  const [docId, setDocId] = useState("");
  const [precioObs, setPrecioObs] = useState("");
  const [razonExt, setRazonExt] = useState("");
  const [resultado, setResultado] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [precioRef, setPrecioRef] = useState("");
  const [potenciales, setPotenciales] = useState("3");
  const [existenciaOferta, setExistenciaOferta] = useState(true);
  const [modalidad, setModalidad] = useState<(typeof MODALIDADES)[number]>("LICITACION_PUBLICA");
  const [linkLicitacionId, setLinkLicitacionId] = useState("");
  const list = trpc.investigacionMercado.list.useQuery({ page, pageSize: 20 });
  const licitaciones = trpc.licitaciones.list.useQuery({ page: 1, pageSize: 50 });
  const detail = trpc.investigacionMercado.getById.useQuery({ id: selectedId! }, { enabled: !!selectedId });
  const analisis = trpc.investigacionMercado.analisisPrecios.useQuery({ investigacionId: selectedId! }, { enabled: !!selectedId });
  const crear = trpc.investigacionMercado.crear.useMutation({ onSuccess: () => list.refetch() });
  const vincular = trpc.investigacionMercado.vincularLicitacion.useMutation({ onSuccess: () => { list.refetch(); detail.refetch(); } });
  const trans = trpc.investigacionMercado.transicionar.useMutation({ onSuccess: () => { list.refetch(); detail.refetch(); } });
  const fuente = trpc.investigacionMercado.registrarFuente.useMutation({ onSuccess: () => { detail.refetch(); analisis.refetch(); } });
  const potencial = trpc.investigacionMercado.identificarPotencial.useMutation({ onSuccess: () => detail.refetch() });

  const selected = detail.data;
  const licOptions = licitaciones.data?.items ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Investigación de mercado"
        description="Estudio previo de planeación: fuentes documentadas, existencia de oferta, precio prevaleciente y modalidad. Debe quedar vinculado a la licitación; si no, publicar fallará aunque el estudio esté CONCLUIDO en pantalla."
        breadcrumbs={[{ label: "Planeación", href: "/planeacion" }, { label: "Investigación de mercado" }]}
      />
      <Card className="border-slate-700/80 bg-slate-900/70"><CardHeader><CardTitle className="text-sm">Abrir estudio</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Input placeholder="Folio" value={folio} onChange={(e) => setFolio(e.target.value)} className="max-w-xs" />
          <Input placeholder="Objeto (≥10)" value={objeto} onChange={(e) => setObjeto(e.target.value)} className="min-w-[14rem] flex-1" />
          <select value={licitacionId} onChange={(e) => setLicitacionId(e.target.value)} className="h-9 rounded border border-slate-700 bg-slate-950 px-2 text-sm max-w-xs">
            <option value="">Licitación (requerida para publicar)</option>
            {licOptions.map((lic: any) => (
              <option key={lic.id} value={String(lic.id)}>{lic.codigo ?? `#${lic.id}`} · {lic.titulo}</option>
            ))}
          </select>
          <Button
            disabled={!folio || objeto.length < 10 || crear.isPending}
            onClick={() => crear.mutate({
              folio,
              objeto,
              licitacionId: licitacionId ? Number(licitacionId) : undefined,
              motivo: "Apertura de investigación de mercado",
            })}
          >Crear estudio</Button>
        </CardContent></Card>
      <Card className="border-slate-700/80 bg-slate-900/70"><CardContent className="p-0">
        <table className="w-full text-sm"><thead><tr className="border-b border-slate-800 text-left text-xs text-slate-500"><th className="p-3">ID</th><th>Folio</th><th>Licitación</th><th>Estado</th><th /></tr></thead>
          <tbody>{(list.data?.items ?? []).map((row: any) => (
            <tr key={row.id} className="border-b border-slate-800">
              <td className="p-3"><button type="button" className="text-amber-400 underline" onClick={() => setSelectedId(row.id)}>{row.id}</button></td>
              <td>{row.folio}</td>
              <td className="text-xs text-slate-400">{row.licitacionId ? `#${row.licitacionId}` : "sin vínculo"}</td>
              <td><StatusBadge status={row.estado} /></td>
              <td className="space-x-1 p-3 text-right">
                {row.estado === "EN_CONSULTA" && <Button size="sm" onClick={() => trans.mutate({ id: row.id, to: "CERRADA", motivo: "Cerrar consulta de fuentes" })}>Cerrar fuentes</Button>}
                {row.estado === "CERRADA" && (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <Input placeholder="Resultado" value={resultado} onChange={(e) => setResultado(e.target.value)} className="max-w-[10rem] h-8" />
                    <Input placeholder="Conclusión" value={conclusion} onChange={(e) => setConclusion(e.target.value)} className="max-w-[12rem] h-8" />
                    <Input placeholder="Precio estimado" value={precioRef} onChange={(e) => setPrecioRef(e.target.value)} className="max-w-[8rem] h-8" />
                    <Input placeholder="Potenciales" value={potenciales} onChange={(e) => setPotenciales(e.target.value)} className="max-w-[6rem] h-8" />
                    <label className="text-xs text-slate-400 inline-flex items-center gap-1">
                      <input type="checkbox" checked={existenciaOferta} onChange={(e) => setExistenciaOferta(e.target.checked)} />
                      Oferta existe
                    </label>
                    <select value={modalidad} onChange={(e) => setModalidad(e.target.value as (typeof MODALIDADES)[number])} className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs">
                      {MODALIDADES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <Button size="sm" disabled={!resultado.trim() || !conclusion.trim() || !precioRef} onClick={() => trans.mutate({ id: row.id, to: "CONCLUIDA", resultado, conclusion, precioReferencia: precioRef, existenciaOferta, potencialesIdentificados: Number(potenciales), modalidadRecomendada: modalidad, motivo: "Concluir estudio" })}>Concluir estudio</Button>
                  </span>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </CardContent></Card>
      {selectedId && (
        <>
          <Card className="border-slate-700/80 bg-slate-900/70"><CardHeader><CardTitle className="text-sm">Vínculo con licitación</CardTitle></CardHeader>
            <CardContent className="space-y-2 p-4 text-sm text-slate-300">
              <p>Estudio #{selectedId} · licitacionId={selected?.licitacionId ?? "null"}.</p>
              <p className="text-xs text-slate-500">El gate de publicar busca un estudio CONCLUIDO con el mismo licitacionId. Sin este vínculo, la pantalla puede decir CONCLUIDO y publicar igual rechaza.</p>
              {!selected?.licitacionId && (
                <div className="flex flex-wrap gap-2">
                  <select value={linkLicitacionId} onChange={(e) => setLinkLicitacionId(e.target.value)} className="h-9 rounded border border-slate-700 bg-slate-950 px-2 text-sm">
                    <option value="">Seleccione licitación</option>
                    {licOptions.map((lic: any) => (
                      <option key={lic.id} value={String(lic.id)}>{lic.codigo ?? `#${lic.id}`} · {lic.titulo}</option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    disabled={!linkLicitacionId || vincular.isPending}
                    onClick={() => vincular.mutate({ id: selectedId, licitacionId: Number(linkLicitacionId), motivo: "Vincular estudio a licitación" })}
                  >Vincular</Button>
                </div>
              )}
            </CardContent></Card>
          <Card className="border-slate-700/80 bg-slate-900/70"><CardHeader><CardTitle className="text-sm">Fuentes del estudio #{selectedId}</CardTitle></CardHeader>
            <CardContent className="space-y-3 p-4">
              <p className="text-xs text-slate-400">Mínimo dos tipos distintos. El documento ID debe existir en el tenant (versión vigente, no RECHAZADO/OBSOLETO). Un número inventado no cierra el estudio.</p>
              <div className="flex flex-wrap gap-3">
                <select value={tipoFuente} onChange={(e) => setTipoFuente(e.target.value)} className="h-9 rounded border border-slate-700 bg-slate-950 px-2 text-sm">
                  <option>PLATAFORMA_HISTORICA</option>
                  <option>CAMARA_ORGANISMO</option>
                  <option>CONSULTA_WEB</option>
                  <option>OFICIO</option>
                  <option>SOLICITUD_INFORMATIVA</option>
                  <option>TABULADOR_RAMO</option>
                  <option>PRESUPUESTO_BASE</option>
                </select>
                <Input placeholder="Descripción de la consulta" value={descFuente} onChange={(e) => setDescFuente(e.target.value)} className="min-w-[16rem] flex-1" />
                <Input placeholder="Documento ID" value={docId} onChange={(e) => setDocId(e.target.value)} className="max-w-[8rem]" />
                <Input placeholder="Precio observado (opcional)" value={precioObs} onChange={(e) => setPrecioObs(e.target.value)} className="max-w-[10rem]" />
                <Button disabled={fuente.isPending || descFuente.length < 10 || !docId} onClick={() => fuente.mutate({ investigacionId: selectedId, tipo: tipoFuente as any, descripcion: descFuente, consultadaAt: new Date().toISOString(), documentoId: Number(docId), precioObservado: precioObs || undefined, motivo: "Registrar fuente del estudio" })}>Registrar fuente</Button>
              </div>
              <div className="flex flex-wrap gap-3">
                <div><Label>Potencial identificado</Label><Input value={razonExt} onChange={(e) => setRazonExt(e.target.value)} /></div>
                <Button className="self-end" disabled={potencial.isPending} onClick={() => potencial.mutate({ investigacionId: selectedId, razonSocialExterna: razonExt || "Proveedor identificado", fuente: "Directorio / plataforma", motivo: "Identificar potencial" })}>Identificar potencial</Button>
              </div>
              <pre className="overflow-auto rounded bg-slate-950/50 p-3 text-xs text-slate-400">{JSON.stringify(detail.data?.fuentes ?? [], null, 2)}</pre>
            </CardContent></Card>
          <Card className="border-slate-700/80 bg-slate-900/70"><CardHeader><CardTitle className="text-sm">Precio prevaleciente (informativo)</CardTitle></CardHeader>
            <CardContent className="p-4 text-sm text-slate-300">
              <p>n={analisis.data?.count ?? 0} · min={String(analisis.data?.min ?? "—")} · max={String(analisis.data?.max ?? "—")} · avg={String(analisis.data?.avg ?? "—")}</p>
              <p className="text-xs text-slate-500 mt-1">No son proposiciones. El comparativo de ofertas ocurre en evaluación, después de la apertura.</p>
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
