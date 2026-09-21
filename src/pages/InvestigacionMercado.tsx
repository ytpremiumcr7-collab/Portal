import { useState } from "react";
import { Link } from "react-router";
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

const FUENTES = [
  "PLATAFORMA_HISTORICA",
  "CAMARA_ORGANISMO",
  "CONSULTA_WEB",
  "OFICIO",
  "SOLICITUD_INFORMATIVA",
  "TABULADOR_RAMO",
  "PRESUPUESTO_BASE",
] as const;

export default function InvestigacionMercado() {
  const [page, setPage] = useState(1);
  const [folio, setFolio] = useState("");
  const [objeto, setObjeto] = useState("");
  const [licitacionId, setLicitacionId] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tipoFuente, setTipoFuente] = useState<(typeof FUENTES)[number]>("PLATAFORMA_HISTORICA");
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
  const docsSoporte = trpc.investigacionMercado.documentosSoporte.useQuery(
    { investigacionId: selectedId! },
    { enabled: !!selectedId && !!detail.data?.licitacionId },
  );
  const crear = trpc.investigacionMercado.crear.useMutation({ onSuccess: () => list.refetch() });
  const vincular = trpc.investigacionMercado.vincularLicitacion.useMutation({ onSuccess: () => { list.refetch(); detail.refetch(); } });
  const trans = trpc.investigacionMercado.transicionar.useMutation({ onSuccess: () => { list.refetch(); detail.refetch(); } });
  const fuente = trpc.investigacionMercado.registrarFuente.useMutation({
    onSuccess: () => { detail.refetch(); analisis.refetch(); docsSoporte.refetch(); },
  });
  const potencial = trpc.investigacionMercado.identificarPotencial.useMutation({ onSuccess: () => detail.refetch() });

  const selected = detail.data;
  const licOptions = licitaciones.data?.items ?? [];
  const fuentes = selected?.fuentes ?? [];
  const tiposDistintos = new Set(fuentes.map((f: any) => f.tipo)).size;
  const puedeCerrar = !!selected?.licitacionId && fuentes.length >= 2 && tiposDistintos >= 2;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Investigación de mercado"
        description="Acto de planeación previo a publicar: fuentes documentadas en el expediente de la licitación, existencia de oferta, precio prevaleciente y modalidad. No es RFQ ni proposición."
        breadcrumbs={[{ label: "Planeación", href: "/planeacion" }, { label: "Investigación de mercado" }]}
      />

      <Card className="border-slate-700/80 bg-slate-900/70">
        <CardHeader><CardTitle className="text-sm">Abrir estudio</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Input placeholder="Folio del estudio" value={folio} onChange={(e) => setFolio(e.target.value)} className="max-w-xs" />
          <Input placeholder="Objeto (≥10)" value={objeto} onChange={(e) => setObjeto(e.target.value)} className="min-w-[14rem] flex-1" />
          <select value={licitacionId} onChange={(e) => setLicitacionId(e.target.value)} className="h-9 rounded border border-slate-700 bg-slate-950 px-2 text-sm max-w-xs">
            <option value="">Licitación (requerida para cerrar y publicar)</option>
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
        </CardContent>
      </Card>

      <Card className="border-slate-700/80 bg-slate-900/70">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                <th className="p-3">ID</th><th>Folio</th><th>Licitación</th><th>Estado</th><th />
              </tr>
            </thead>
            <tbody>
              {(list.data?.items ?? []).map((row: any) => (
                <tr key={row.id} className="border-b border-slate-800">
                  <td className="p-3">
                    <button type="button" className="text-amber-400 underline" onClick={() => setSelectedId(row.id)}>{row.id}</button>
                  </td>
                  <td>{row.folio}</td>
                  <td className="text-xs text-slate-400">
                    {row.licitacionId ? (
                      <Link className="underline" to={`/licitaciones/${row.licitacionId}`}>#{row.licitacionId}</Link>
                    ) : "sin vínculo — publicar fallará"}
                  </td>
                  <td><StatusBadge status={row.estado} /></td>
                  <td className="space-x-1 p-3 text-right">
                    {row.estado === "EN_CONSULTA" && (
                      <Button
                        size="sm"
                        disabled={!row.licitacionId}
                        title={!row.licitacionId ? "Vincule la licitación antes de cerrar" : undefined}
                        onClick={() => trans.mutate({ id: row.id, to: "CERRADA", motivo: "Cerrar consulta de fuentes" })}
                      >Cerrar fuentes</Button>
                    )}
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
                        <Button
                          size="sm"
                          disabled={!resultado.trim() || !conclusion.trim() || !precioRef || !row.licitacionId}
                          onClick={() => trans.mutate({
                            id: row.id, to: "CONCLUIDA", resultado, conclusion, precioReferencia: precioRef,
                            existenciaOferta, potencialesIdentificados: Number(potenciales),
                            modalidadRecomendada: modalidad, motivo: "Concluir estudio",
                          })}
                        >Concluir estudio</Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {selectedId && (
        <>
          <Card className="border-slate-700/80 bg-slate-900/70">
            <CardHeader><CardTitle className="text-sm">Vínculo con el procedimiento</CardTitle></CardHeader>
            <CardContent className="space-y-2 p-4 text-sm text-slate-300">
              <p>Estudio #{selectedId} · estado {selected?.estado ?? "…"} · licitacionId={selected?.licitacionId ?? "null"}.</p>
              <p className="text-xs text-slate-500">
                {puedeCerrar
                  ? "Hay al menos dos tipos de fuente documentados y el estudio está vinculado. Cerrar/concluir es el acto que habilita publicar."
                  : "Falta vínculo o faltan dos tipos de fuente con documento del expediente. Publicar seguirá rechazando."}
              </p>
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
              {selected?.licitacionId && (
                <p className="text-xs">
                  <Link className="text-amber-400 underline" to={`/licitaciones/${selected.licitacionId}`}>Abrir procedimiento</Link>
                  {" · "}
                  <Link className="text-amber-400 underline" to={`/documentos?licitacionId=${selected.licitacionId}`}>Cargar evidencia al expediente</Link>
                  {" (tipo FUNDAMENTO_JURIDICO u OTRO)."}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-700/80 bg-slate-900/70">
            <CardHeader><CardTitle className="text-sm">Fuentes documentadas · estudio #{selectedId}</CardTitle></CardHeader>
            <CardContent className="space-y-3 p-4">
              <p className="text-xs text-slate-400">
                Art. 47 RLAASSP: mínimo dos tipos distintos. El soporte se elige del expediente de la licitación vinculada; no se teclea un ID inventado.
              </p>
              <div className="flex flex-wrap gap-3">
                <select value={tipoFuente} onChange={(e) => setTipoFuente(e.target.value as (typeof FUENTES)[number])} className="h-9 rounded border border-slate-700 bg-slate-950 px-2 text-sm">
                  {FUENTES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <Input placeholder="Descripción de la consulta (≥10)" value={descFuente} onChange={(e) => setDescFuente(e.target.value)} className="min-w-[16rem] flex-1" />
                <select value={docId} onChange={(e) => setDocId(e.target.value)} className="h-9 rounded border border-slate-700 bg-slate-950 px-2 text-sm min-w-[16rem]">
                  <option value="">{selected?.licitacionId ? "Documento de soporte" : "Vincule la licitación primero"}</option>
                  {(docsSoporte.data?.items ?? []).map((d: any) => (
                    <option key={d.id} value={String(d.id)}>#{d.id} · {d.tipo} · {d.nombreArchivo} · {d.estado}</option>
                  ))}
                </select>
                <Input placeholder="Precio observado (opcional)" value={precioObs} onChange={(e) => setPrecioObs(e.target.value)} className="max-w-[10rem]" />
                <Button
                  disabled={fuente.isPending || descFuente.length < 10 || !docId || !selected?.licitacionId}
                  onClick={() => fuente.mutate({
                    investigacionId: selectedId,
                    tipo: tipoFuente,
                    descripcion: descFuente,
                    consultadaAt: new Date().toISOString(),
                    documentoId: Number(docId),
                    precioObservado: precioObs || undefined,
                    motivo: "Registrar fuente del estudio",
                  })}
                >Registrar fuente</Button>
              </div>
              {docsSoporte.data && !docsSoporte.data.items.length && (
                <p className="text-xs text-amber-400">
                  No hay documentos FUNDAMENTO_JURIDICO u OTRO vigentes en el expediente. Cárguelos antes de registrar la fuente.
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <div><Label>Potencial identificado</Label><Input value={razonExt} onChange={(e) => setRazonExt(e.target.value)} /></div>
                <Button className="self-end" disabled={potencial.isPending} onClick={() => potencial.mutate({ investigacionId: selectedId, razonSocialExterna: razonExt || "Proveedor identificado", fuente: "Directorio / plataforma", motivo: "Identificar potencial" })}>Identificar potencial</Button>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-slate-500">
                    <th className="py-2">Tipo</th><th>Descripción</th><th>Documento</th><th>Precio</th>
                  </tr>
                </thead>
                <tbody>
                  {fuentes.map((f: any) => (
                    <tr key={f.id} className="border-b border-slate-800">
                      <td className="py-2 pr-2">{f.tipo}</td>
                      <td className="pr-2">{f.descripcion}</td>
                      <td className="pr-2 text-slate-400">
                        {f.documento
                          ? `#${f.documento.id} · ${f.documento.tipo} · ${f.documento.nombreArchivo} · ${f.documento.estado}`
                          : `#${f.documentoId}`}
                      </td>
                      <td>{f.precioObservado ?? "—"}</td>
                    </tr>
                  ))}
                  {!fuentes.length && (
                    <tr><td colSpan={4} className="py-3 text-slate-500">Aún no hay fuentes. Una cotización suelta no cuenta.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card className="border-slate-700/80 bg-slate-900/70">
            <CardHeader><CardTitle className="text-sm">Precio prevaleciente (informativo)</CardTitle></CardHeader>
            <CardContent className="p-4 text-sm text-slate-300">
              <p>n={analisis.data?.count ?? 0} · min={String(analisis.data?.min ?? "—")} · max={String(analisis.data?.max ?? "—")} · avg={String(analisis.data?.avg ?? "—")}</p>
              <p className="text-xs text-slate-500 mt-1">No son proposiciones. El comparativo de ofertas ocurre en evaluación, después de la apertura.</p>
            </CardContent>
          </Card>
        </>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
        <Button variant="outline" onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}
