import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import PageHeader from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";

/** Área proveedor: oportunidades = procedimientos PUBLICADA */
export default function Oportunidades() {
  const { data, isLoading } = trpc.licitaciones.list.useQuery({ estado: "PUBLICADA", pageSize: 50 });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Oportunidades de participación"
        description="Procedimientos publicados en los que puede presentar proposición documental."
        breadcrumbs={[{ label: "Área proveedor" }, { label: "Oportunidades" }]}
      />
      <div className="ares-panel overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-sm text-slate-500">Cargando…</p>
        ) : !data?.items?.length ? (
          <div className="ares-empty">
            <p className="ares-empty-title">Sin oportunidades abiertas</p>
          </div>
        ) : (
          <table className="ares-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Título</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row: any) => (
                <tr key={row.id}>
                  <td className="font-mono text-xs">{row.codigo}</td>
                  <td>{row.titulo}</td>
                  <td><StatusBadge status={row.estado} /></td>
                  <td className="space-x-3">
                    <Link to={`/presentar-propuesta?licitacionId=${row.id}`} className="text-xs font-medium underline">
                      Presentar propuesta
                    </Link>
                    <Link to={`/licitaciones/${row.id}`} className="text-xs text-slate-600 underline">
                      Detalle
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
