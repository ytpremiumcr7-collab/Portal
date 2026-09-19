import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ares/StatusBadge";

export default function Convocatorias() {
  const { data, isLoading } = trpc.consultaPublica.procedimientos.useQuery({
    estado: "PUBLICADA",
    pageSize: 50,
  });

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="ares-gov-header">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-emerald-300" />
            <div>
              <p className="font-semibold">Convocatorias publicadas</p>
              <p className="text-[11px] text-slate-300">Portal público · ARES</p>
            </div>
          </div>
          <Button asChild variant="secondary" size="sm" className="bg-white text-slate-900">
            <Link to="/portal">Volver al portal</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="ares-panel overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <h1 className="text-sm font-semibold text-slate-800">Procedimientos en convocatoria</h1>
            <p className="text-xs text-slate-500">Fuente: API pública de consulta. Solo estados publicables.</p>
          </div>
          {isLoading ? (
            <p className="p-6 text-sm text-slate-500">Cargando convocatorias…</p>
          ) : !data?.items?.length ? (
            <div className="ares-empty">
              <p className="ares-empty-title">No hay convocatorias publicadas</p>
              <p className="ares-empty-desc">Cuando una dependencia publique un procedimiento, aparecerá aquí.</p>
            </div>
          ) : (
            <table className="ares-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Título</th>
                  <th>Modalidad</th>
                  <th>Estado</th>
                  <th>Cierre</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row: any) => (
                  <tr key={row.id}>
                    <td className="font-mono text-xs">{row.codigo}</td>
                    <td>{row.titulo}</td>
                    <td className="text-xs">{row.tipoLicitacion}</td>
                    <td><StatusBadge status={row.estado} /></td>
                    <td className="text-xs text-slate-600">
                      {row.fechaCierre ? String(row.fechaCierre).slice(0, 10) : "—"}
                    </td>
                    <td>
                      <Link className="text-xs font-medium text-[hsl(222_47%_28%)] underline" to={`/consulta-publica?id=${row.id}`}>
                        Ver detalle
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
