import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";
import { EmptyState } from "@/components/ares/EmptyState";
import { Globe, Search, Shield, X } from "lucide-react";
import { PRODUCT_NAME } from "@/const";

/** Public open-data surface — no auth required for tRPC consultaPublica.* */
export default function ConsultaPublica() {
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const resumen = trpc.consultaPublica.resumen.useQuery({});
  const procs = trpc.consultaPublica.procedimientos.useQuery({
    page,
    pageSize: 10,
    q: q || undefined,
    estado: estado || undefined,
  });
  const detail = trpc.consultaPublica.procedimientoDetalle.useQuery(
    { id: detailId! },
    { enabled: detailId != null },
  );
  const sanc = trpc.consultaPublica.sancionados.useQuery({ page: 1, pageSize: 10 });
  const adjs = trpc.consultaPublica.adjudicaciones.useQuery({ page: 1, pageSize: 10 });

  const formatCurrency = (v: string | number | null | undefined) => {
    if (v == null || v === "") return "—";
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (Number.isNaN(n)) return String(v);
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  };

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Public masthead */}
      <header className="border-b border-slate-800 bg-slate-900/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded border border-slate-700 bg-slate-950">
              <Shield className="h-4 w-4 text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide text-slate-50">{PRODUCT_NAME}</p>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Consulta pública · Datos abiertos
              </p>
            </div>
          </div>
          <Link
            to="/login"
            className="text-xs font-medium text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
          >
            Acceso al sistema
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <PageHeader
          title="Consulta pública de contrataciones"
          description="Acceso abierto a procedimientos publicados, adjudicaciones, contratos y proveedores sancionados o impedidos. No requiere autenticación."
          breadcrumbs={[{ label: "Público" }, { label: "Consulta" }]}
          meta={
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Globe className="h-3.5 w-3.5" /> Transparencia en la contratación pública
            </span>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: "Procedimientos publicados", value: resumen.data?.procedimientosPublicados },
            { label: "Adjudicaciones", value: resumen.data?.adjudicacionesPublicadas },
            { label: "Proveedores impedidos", value: resumen.data?.proveedoresImpedidosActivos },
          ].map((m) => (
            <Card key={m.label} className="border-slate-700/80 bg-slate-900/70 shadow-none">
              <CardContent className="p-4">
                <p className="text-2xl font-semibold tabular-nums text-slate-50">
                  {m.value ?? "—"}
                </p>
                <p className="mt-1 text-xs text-slate-500">{m.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search-first */}
        <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
          <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Search className="h-4 w-4 text-slate-400" />
              Buscar procedimientos
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:px-5">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="q-pub" className="ares-label">
                Código o título
              </Label>
              <Input
                id="q-pub"
                placeholder="Ej. LA-001 o suministros de equipo"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="ares-input"
                onKeyDown={(e) => {
                  if (e.key === "Enter") setPage(1);
                }}
              />
            </div>
            <div className="w-full space-y-1.5 sm:w-48">
              <Label htmlFor="estado-pub" className="ares-label">
                Estado (opcional)
              </Label>
              <Input
                id="estado-pub"
                placeholder="PUBLICADA"
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
                className="ares-input"
              />
            </div>
            <Button className="ares-cta shrink-0" onClick={() => setPage(1)}>
              Consultar
            </Button>
          </CardContent>
        </Card>

        <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
          <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
            <CardTitle className="text-sm font-semibold text-slate-100">
              Resultados de procedimientos
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(procs.data?.items ?? []).length === 0 ? (
              <EmptyState
                title="Sin resultados públicos"
                description="Ajuste los criterios de búsqueda o consulte más adelante. Solo se muestran procedimientos publicados."
                icon={<Search className="h-5 w-5" />}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="ares-table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Título</th>
                      <th>Estado</th>
                      <th className="text-right!">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(procs.data?.items ?? []).map((p: any) => (
                      <tr key={p.id}>
                        <td className="font-mono text-xs text-slate-400">{p.codigo}</td>
                        <td className="max-w-md truncate text-slate-100">{p.titulo}</td>
                        <td>
                          <StatusBadge status={p.estado} />
                        </td>
                        <td className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-amber-500 hover:text-amber-400"
                            onClick={() => setDetailId(p.id)}
                          >
                            Ver detalle
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-4 py-3">
              <Button
                variant="outline"
                size="sm"
                className="border-slate-600 text-slate-300"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </Button>
              <span className="text-xs text-slate-500">
                Página {page} de {procs.data?.pageCount ?? 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="border-slate-600 text-slate-300"
                disabled={!procs.data || page >= (procs.data.pageCount ?? 1)}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente
              </Button>
            </div>
          </CardContent>
        </Card>

        {detailId != null && detail.data && (
          <Card className="border-slate-600 bg-slate-900 shadow-none">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 border-b border-slate-800 px-4 py-3 sm:px-5">
              <div>
                <p className="font-mono text-[11px] text-slate-500">
                  {detail.data.procedimiento.codigo}
                </p>
                <CardTitle className="mt-0.5 text-base font-semibold text-slate-50">
                  {detail.data.procedimiento.titulo}
                </CardTitle>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400"
                onClick={() => setDetailId(null)}
                aria-label="Cerrar detalle"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4 p-4 text-sm sm:grid-cols-2 sm:px-5">
              <div>
                <p className="text-xs text-slate-500">Objeto</p>
                <p className="mt-0.5 text-slate-200">{detail.data.procedimiento.objeto}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Estado / etapa</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-slate-200">
                  <StatusBadge status={detail.data.procedimiento.estado} />
                  <span className="text-slate-400">{detail.data.procedimiento.etapa}</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Monto presupuestado</p>
                <p className="mt-0.5 font-semibold tabular-nums text-slate-100">
                  {formatCurrency(detail.data.procedimiento.montoPresupuestado)}
                </p>
              </div>
              {detail.data.adjudicacion && (
                <div>
                  <p className="text-xs text-slate-500">Adjudicación</p>
                  <p className="mt-0.5 text-slate-200">
                    Proveedor {detail.data.adjudicacion.proveedorGanadorId} —{" "}
                    {formatCurrency(detail.data.adjudicacion.montoAdjudicado)}
                  </p>
                </div>
              )}
              {detail.data.contrato && (
                <div>
                  <p className="text-xs text-slate-500">Contrato</p>
                  <p className="mt-0.5 text-slate-200">
                    {detail.data.contrato.folio} ({detail.data.contrato.estado})
                  </p>
                </div>
              )}
              <div className="sm:col-span-2">
                <p className="mb-1.5 text-xs text-slate-500">Documentos públicos</p>
                {(detail.data.documentosPublicos ?? []).length === 0 ? (
                  <p className="text-xs text-slate-500">Sin documentos públicos asociados.</p>
                ) : (
                  <ul className="space-y-1">
                    {(detail.data.documentosPublicos ?? []).map((d: any) => (
                      <li key={d.id} className="text-xs text-slate-300">
                        <span className="font-medium text-slate-400">{d.tipo}</span> — {d.nombreArchivo}{" "}
                        <span className="text-slate-500">v{d.version}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
            <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
              <CardTitle className="text-sm font-semibold text-slate-100">
                Adjudicaciones publicadas
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(adjs.data?.items ?? []).length === 0 ? (
                <EmptyState title="Sin adjudicaciones publicadas" className="py-8" />
              ) : (
                <ul className="divide-y divide-slate-800/80">
                  {(adjs.data?.items ?? []).map((a: any) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5"
                    >
                      <span className="text-slate-200">
                        Lic. {a.licitacionId} — {formatCurrency(a.montoAdjudicado)}
                      </span>
                      <span className="shrink-0 text-xs text-slate-500">Prov. {a.proveedorGanadorId}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
            <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
              <CardTitle className="text-sm font-semibold text-slate-100">
                Proveedores sancionados / impedidos
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(sanc.data?.items ?? []).length === 0 ? (
                <EmptyState title="Sin registros de impedimento" className="py-8" />
              ) : (
                <ul className="divide-y divide-slate-800/80">
                  {(sanc.data?.items ?? []).map((s: any) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5"
                    >
                      <span className="min-w-0 truncate text-slate-200">
                        {s.razonSocial ?? `Prov. ${s.proveedorId}`}{" "}
                        <span className="text-slate-500">({s.rfc ?? "—"})</span>
                      </span>
                      <span className="shrink-0 text-xs text-slate-500">
                        hasta {s.vigenteHasta ?? "indefinido"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <footer className="border-t border-slate-800 pt-4 text-center text-[11px] text-slate-600">
          La información publicada tiene carácter informativo. Para efectos legales consulte el
          expediente oficial de la entidad contratante.
        </footer>
      </div>
    </div>
  );
}
