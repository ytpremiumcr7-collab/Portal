import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Public open-data surface — no auth required for tRPC consultaPublica.* */
export default function ConsultaPublica() {
  const resumen = trpc.consultaPublica.resumen.useQuery({});
  const procs = trpc.consultaPublica.procedimientos.useQuery({ page: 1, pageSize: 10 });
  const sanc = trpc.consultaPublica.sancionados.useQuery({ page: 1, pageSize: 10 });
  const adjs = trpc.consultaPublica.adjudicaciones.useQuery({ page: 1, pageSize: 10 });
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Consulta pública</h2>
      <p className="text-sm text-slate-400">Datos abiertos: procedimientos, adjudicaciones, contratos y lista de sancionados. Sin autenticación de admin.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-slate-700 bg-slate-800/50"><CardContent className="pt-6"><p className="text-3xl font-bold text-amber-400">{resumen.data?.procedimientosPublicados ?? "—"}</p><p className="text-xs text-slate-400">Procedimientos publicados</p></CardContent></Card>
        <Card className="border-slate-700 bg-slate-800/50"><CardContent className="pt-6"><p className="text-3xl font-bold text-amber-400">{resumen.data?.adjudicacionesPublicadas ?? "—"}</p><p className="text-xs text-slate-400">Adjudicaciones</p></CardContent></Card>
        <Card className="border-slate-700 bg-slate-800/50"><CardContent className="pt-6"><p className="text-3xl font-bold text-amber-400">{resumen.data?.proveedoresImpedidosActivos ?? "—"}</p><p className="text-xs text-slate-400">Proveedores impedidos</p></CardContent></Card>
      </div>
      <Card className="border-slate-700 bg-slate-800/50">
        <CardHeader><CardTitle className="text-white">Procedimientos</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(procs.data?.items ?? []).map((p: any) => (
            <div key={p.id} className="flex justify-between text-sm border-b border-slate-800 py-2">
              <span className="text-white">{p.codigo} — {p.titulo}</span>
              <span className="text-slate-400">{p.estado}</span>
            </div>
          ))}
          {!procs.data?.items?.length && <p className="text-slate-500 text-sm">Sin datos públicos</p>}
        </CardContent>
      </Card>
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
