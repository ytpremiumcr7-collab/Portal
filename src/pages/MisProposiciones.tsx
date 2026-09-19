import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import PageHeader from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";

/** Área proveedor: proposiciones propias y su estado (sin filtrar precios ajenos). */
export default function MisProposiciones() {
  const { data, isLoading } = trpc.participaciones.list.useQuery({ pageSize: 50 });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mis proposiciones"
        description="Estado de las proposiciones que ha presentado. El monto de terceros permanece sellado hasta la apertura."
        breadcrumbs={[{ label: "Área proveedor" }, { label: "Mis proposiciones" }]}
      />
      <div className="ares-panel overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-sm text-slate-500">Cargando…</p>
        ) : !data?.items?.length ? (
          <div className="ares-empty">
            <p className="ares-empty-title">Sin proposiciones</p>
            <p className="mt-1 text-sm text-slate-500">
              Consulte <Link className="underline" to="/oportunidades">oportunidades</Link> para presentar.
            </p>
          </div>
        ) : (
          <table className="ares-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Procedimiento</th>
                <th>Estado</th>
                <th>Monto (propio)</th>
                <th>Recibido</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row: any) => (
                <tr key={row.id}>
                  <td className="font-mono text-xs">{row.id}</td>
                  <td>{row.licitacion?.codigo ?? row.licitacionId}</td>
                  <td><StatusBadge status={row.estadoEvaluacion} /></td>
                  <td className="font-mono text-xs">
                    {row.sobreEconomicoSellado ? "—" : row.montoOferta != null ? `$${row.montoOferta}` : "—"}
                  </td>
                  <td className="text-xs text-slate-500">
                    {row.recibidoAt ? new Date(row.recibidoAt).toLocaleString("es-MX") : "—"}
                  </td>
                  <td>
                    <Link to={`/licitaciones/${row.licitacionId}`} className="text-xs font-medium underline">
                      Ver procedimiento
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
