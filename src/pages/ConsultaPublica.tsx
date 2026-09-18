import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** Public open-data surface — no auth required for tRPC consultaPublica.* */
export default function ConsultaPublica() {
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const resumen = trpc.consultaPublica.resumen.useQuery({});
  const procs = trpc.consultaPublica.procedimientos.useQuery({
    page, pageSize: 10, q: q || undefined, estado: estado || undefined,
  });
  const detail = trpc.consultaPublica.procedimientoDetalle.useQuery(
    { id: detailId! },
    { enabled: detailId != null },
  );
  const sanc = trpc.consultaPublica.sancionados.useQuery({ page: 1, pageSize: 10 });
  const adjs = trpc.consultaPublica.adjudicaciones.useQuery({ page: 1, pageSize: 10 });
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Consulta pública</h2>
      <p className="text-sm text-slate-400">Datos abiertos: procedimientos, adjudicaciones, contratos y sancionados. Sin autenticación de admin.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-slate-700 bg-slate-800/50"><CardContent className="pt-6"><p className="text-3xl font-bold text-amber-400">{resumen.data?.procedimientosPublicados ?? "—"}</p><p className="text-xs text-slate-400">Procedimientos publicados</p></CardContent></Card>
        <Card className="border-slate-700 bg-slate-800/50"><CardContent className="pt-6"><p className="text-3xl font-bold text-amber-400">{resumen.data?.adjudicacionesPublicadas ?? "—"}</p><p className="text-xs text-slate-400">Adjudicaciones</p></CardContent></Card>
        <Card className="border-slate-700 bg-slate-800/50"><CardContent className="pt-6"><p className="text-3xl font-bold text-amber-400">{resumen.data?.proveedoresImpedidosActivos ?? "—"}</p><p className="text-xs text-slate-400">Proveedores impedidos</p></CardContent></Card>
      </div>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Buscar procedimientos</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Input placeholder="Código o título" value={q} onChange={e => setQ(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-sm" />
          <Input placeholder="Estado (opcional)" value={estado} onChange={e => setEstado(e.target.value)} className="bg-slate-700 border-slate-600 text-white max-w-xs" />
          <Button onClick={() => setPage(1)}>Filtrar</Button>
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Procedimientos</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(procs.data?.items ?? []).map((p: any) => (
            <button key={p.id} type="button" className="w-full flex justify-between text-sm border-b border-slate-800 py-2 text-left hover:bg-slate-800/80"
              onClick={() => setDetailId(p.id)}>
              <span className="text-white">{p.codigo} — {p.titulo}</span>
              <span className="text-slate-400">{p.estado}</span>
            </button>
          ))}
          {!procs.data?.items?.length && <p className="text-slate-500 text-sm">Sin datos públicos</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
            <Button variant="outline" size="sm" disabled={!procs.data || page >= (procs.data.pageCount ?? 1)} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
          </div>
        </CardContent>
      </Card>
      {detailId != null && detail.data && (
        <Card className="border-amber-700/50 bg-slate-800/50">
          <CardHeader><CardTitle className="text-white">Detalle — {detail.data.procedimiento.codigo}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-300">
            <p><span className="text-slate-500">Título:</span> {detail.data.procedimiento.titulo}</p>
            <p><span className="text-slate-500">Objeto:</span> {detail.data.procedimiento.objeto}</p>
            <p><span className="text-slate-500">Estado/etapa:</span> {detail.data.procedimiento.estado} / {detail.data.procedimiento.etapa}</p>
            <p><span className="text-slate-500">Monto:</span> ${detail.data.procedimiento.montoPresupuestado}</p>
            {detail.data.adjudicacion && <p><span className="text-slate-500">Adjudicación:</span> prov {detail.data.adjudicacion.proveedorGanadorId} — ${detail.data.adjudicacion.montoAdjudicado}</p>}
            {detail.data.contrato && <p><span className="text-slate-500">Contrato:</span> {detail.data.contrato.folio} ({detail.data.contrato.estado})</p>}
            <div>
              <p className="text-slate-500 mb-1">Documentos públicos</p>
              {(detail.data.documentosPublicos ?? []).map((d: any) => (
                <div key={d.id} className="text-xs">{d.tipo} — {d.nombreArchivo} v{d.version}</div>
              ))}
              {!detail.data.documentosPublicos?.length && <p className="text-xs text-slate-500">Sin documentos públicos</p>}
            </div>
            <Button variant="outline" size="sm" onClick={() => setDetailId(null)}>Cerrar detalle</Button>
          </CardContent>
        </Card>
      )}
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Adjudicaciones publicadas</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(adjs.data?.items ?? []).map((a: any) => (
            <div key={a.id} className="flex justify-between text-sm border-b border-slate-800 py-2">
              <span className="text-white">Lic. {a.licitacionId} — ${a.montoAdjudicado}</span>
              <span className="text-slate-400">Prov. {a.proveedorGanadorId}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Proveedores sancionados / impedidos</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(sanc.data?.items ?? []).map((s: any) => (
            <div key={s.id} className="flex justify-between text-sm border-b border-slate-800 py-2">
              <span className="text-white">{s.razonSocial ?? `Prov. ${s.proveedorId}`} ({s.rfc ?? "—"})</span>
              <span className="text-slate-400">hasta {s.vigenteHasta ?? "indefinido"}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
