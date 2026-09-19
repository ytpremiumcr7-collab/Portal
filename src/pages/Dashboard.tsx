import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";
import { EmptyState } from "@/components/ares/EmptyState";
import {
  FileText,
  Users,
  TrendingUp,
  AlertTriangle,
  Shield,
  ChevronRight,
  CheckCircle,
  Briefcase,
} from "lucide-react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

function MetricCard({
  title,
  value,
  icon,
  tone = "default",
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  tone?: "default" | "warn" | "ok" | "accent";
}) {
  const toneCls = {
    default: "border-slate-700/80 bg-slate-900/70",
    warn: "border-red-900/50 bg-red-950/20",
    ok: "border-emerald-900/40 bg-emerald-950/15",
    accent: "border-slate-700/80 bg-slate-900/70",
  }[tone];
  const iconCls = {
    default: "bg-slate-800 text-sky-400",
    warn: "bg-red-950/60 text-red-400",
    ok: "bg-emerald-950/50 text-emerald-400",
    accent: "bg-slate-800 text-amber-500",
  }[tone];

  return (
    <Card className={cn("shadow-none", toneCls)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
            <p className="mt-1.5 truncate text-2xl font-semibold tabular-nums text-slate-50">{value}</p>
          </div>
          <div className={cn("rounded-md p-2.5", iconCls)}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: metrics, isLoading: mLoading, isError: mErr } = trpc.dashboard.metrics.useQuery();
  const { data: recentLics, isLoading: lLoading, isError: lErr } = trpc.dashboard.recentLicitaciones.useQuery();
  const { data: recentAlerts, isLoading: aLoading, isError: aErr } = trpc.dashboard.recentAlertas.useQuery();

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);

  const today = new Date().toLocaleDateString("es-MX", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  if (mErr || lErr || aErr) {
    return (
      <div className="flex h-72 items-center justify-center">
        <EmptyState
          title="No fue posible cargar el tablero"
          description="Verifique su sesión o recargue la página. Si el problema persiste, contacte al administrador del sistema."
          icon={<AlertTriangle className="h-6 w-6" />}
        />
      </div>
    );
  }

  if (mLoading || lLoading || aLoading) {
    return (
      <div className="flex h-72 items-center justify-center gap-3 text-sm text-slate-400">
        <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" aria-hidden>
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Cargando resumen ejecutivo…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tablero ejecutivo"
        description="Resumen operativo de procedimientos de contratación, proveedores verificados y alertas de integridad."
        breadcrumbs={[{ label: "Inicio" }, { label: "Tablero ejecutivo" }]}
        meta={<span className="text-xs capitalize text-slate-500">{today}</span>}
      />

      {metrics && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Licitaciones activas"
            value={metrics.licitacionesActivas}
            icon={<FileText className="h-4 w-4" />}
          />
          <MetricCard
            title="Proveedores verificados"
            value={metrics.proveedoresActivos}
            icon={<Users className="h-4 w-4" />}
            tone="ok"
          />
          <MetricCard
            title="Monto adjudicado"
            value={formatCurrency(metrics.montoTotalAdjudicadoPeriodo)}
            icon={<TrendingUp className="h-4 w-4" />}
            tone="accent"
          />
          <MetricCard
            title="Alertas urgentes"
            value={metrics.alertasUrgentes}
            icon={<AlertTriangle className="h-4 w-4" />}
            tone={metrics.alertasUrgentes > 0 ? "warn" : "default"}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border-slate-700/80 bg-slate-900/70 shadow-none lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-slate-800 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-slate-400" />
              <CardTitle className="text-sm font-semibold text-slate-100">
                Procedimientos recientes
              </CardTitle>
            </div>
            <Link
              to="/licitaciones"
              className="flex items-center gap-1 text-xs font-medium text-amber-500 hover:text-amber-400"
            >
              Ver catálogo <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {!recentLics?.length ? (
              <EmptyState
                title="Sin procedimientos recientes"
                description="Cuando se registren licitaciones, aparecerán aquí con su estado y monto presupuestado."
                icon={<FileText className="h-5 w-5" />}
                action={
                  <Link to="/licitaciones/nueva" className="text-xs font-medium text-amber-500 hover:text-amber-400">
                    Registrar nueva licitación
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-slate-800/80">
                {recentLics.map((lic: any) => (
                  <li key={lic.id}>
                    <Link
                      to={`/licitaciones/${lic.id}`}
                      className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-slate-800/40 sm:px-5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-slate-400">{lic.codigo}</span>
                          <StatusBadge status={lic.estado} />
                        </div>
                        <p className="truncate text-sm font-medium text-slate-100">{lic.titulo}</p>
                        <p className="truncate text-xs text-slate-500">{lic.entidad?.razonSocial}</p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-200">
                        {formatCurrency(parseFloat(lic.montoPresupuestado))}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
          <CardHeader className="space-y-0 border-b border-slate-800 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-slate-400" />
              <CardTitle className="text-sm font-semibold text-slate-100">
                Alertas de integridad
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!recentAlerts?.length ? (
              <div className="flex items-start gap-3 px-4 py-6 sm:px-5">
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <div>
                  <p className="text-sm font-medium text-emerald-300">Sin alertas pendientes</p>
                  <p className="mt-1 text-xs text-slate-500">
                    No hay hallazgos de integridad pendientes de atención en este momento.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-slate-800/80">
                {recentAlerts.map((alerta: any) => (
                  <li key={alerta.id} className="border-l-2 border-l-red-700/70 px-4 py-3 sm:px-5">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <StatusBadge status={alerta.severidad} />
                      <span className="font-mono text-[11px] text-slate-500">{alerta.codigo}</span>
                    </div>
                    <p className="text-sm leading-snug text-slate-300">{alerta.descripcion}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-slate-800 px-4 py-2.5 sm:px-5">
              <Link to="/alertas" className="text-xs font-medium text-amber-500 hover:text-amber-400">
                Ir al módulo de alertas →
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
