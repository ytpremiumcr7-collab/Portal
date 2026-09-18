import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
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

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ title, value, icon, color }: StatCardProps) {
  return (
    <Card className="border-slate-700 bg-slate-800/50">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-slate-400">{title}</p>
            <h3 className="text-2xl font-bold text-white mt-1">{value}</h3>
          </div>
          <div className={`p-3 rounded-lg bg-gradient-to-br ${color} shadow-lg`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: metrics, isLoading: mLoading } = trpc.dashboard.metrics.useQuery();
  const { data: recentLics, isLoading: lLoading } = trpc.dashboard.recentLicitaciones.useQuery();
  const { data: recentAlerts, isLoading: aLoading } = trpc.dashboard.recentAlertas.useQuery();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getEstadoBadge = (estado: string) => {
    const variants: Record<string, string> = {
      BORRADOR: "bg-slate-600 text-slate-200",
      PUBLICADA: "bg-emerald-600 text-emerald-100",
      EN_EVALUACION: "bg-blue-600 text-blue-100",
      ADJUDICADA: "bg-purple-600 text-purple-100",
      FINALIZADA: "bg-slate-600 text-slate-200",
      CANCELADA: "bg-red-600 text-red-100",
    };
    return variants[estado] || "bg-slate-600 text-slate-200";
  };

  const getSeveridadBadge = (severidad: string) => {
    const variants: Record<string, string> = {
      BAJA: "bg-blue-600 text-blue-100",
      MEDIA: "bg-amber-600 text-amber-100",
      ALTA: "bg-orange-600 text-orange-100",
      CRITICA: "bg-red-600 text-red-100",
    };
    return variants[severidad] || "bg-slate-600 text-slate-200";
  };

  if (mLoading || lLoading || aLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex items-center gap-3 text-slate-400">
          <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Cargando dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="w-6 h-6 text-amber-500" />
          <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        </div>
        <p className="text-slate-400 text-sm">
          {new Date().toLocaleDateString("es-MX", {
            weekday: "long", year: "numeric", month: "long", day: "numeric",
          })}
        </p>
      </div>

      {metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Licitaciones Activas" value={metrics.licitacionesActivas} icon={<FileText className="w-5 h-5 text-white" />} color="from-blue-500 to-blue-600" />
          <StatCard title="Proveedores Verificados" value={metrics.proveedoresActivos} icon={<Users className="w-5 h-5 text-white" />} color="from-emerald-500 to-emerald-600" />
          <StatCard title="Monto Adjudicado" value={formatCurrency(metrics.montoTotalAdjudicadoPeriodo)} icon={<TrendingUp className="w-5 h-5 text-white" />} color="from-amber-500 to-orange-600" />
          <StatCard title="Alertas Urgentes" value={metrics.alertasUrgentes} icon={<AlertTriangle className="w-5 h-5 text-white" />} color="from-red-500 to-red-600" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-slate-700 bg-slate-800/50">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-3">
              <Briefcase className="w-5 h-5 text-amber-500" />
              <CardTitle className="text-white">Licitaciones Recientes</CardTitle>
            </div>
            <Link to="/licitaciones" className="text-sm text-amber-500 hover:text-amber-400 flex items-center gap-1">
              Ver todas <ChevronRight className="w-4 h-4" />
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentLics?.length === 0 ? (
                <p className="text-slate-500 text-center py-8">No hay licitaciones recientes</p>
              ) : (
                recentLics?.map((lic: any) => (
                  <Link key={lic.id} to={`/licitaciones/${lic.id}`} className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-amber-500">{lic.codigo}</span>
                        <Badge className={`text-xs ${getEstadoBadge(lic.estado)}`}>{lic.estado.replace(/_/g, " ")}</Badge>
                      </div>
                      <h4 className="text-sm font-medium text-white truncate">{lic.titulo}</h4>
                      <p className="text-xs text-slate-400 truncate">{lic.entidad?.razonSocial}</p>
                    </div>
                    <div className="text-right ml-4">
                      <p className="text-sm font-semibold text-white">
                        {formatCurrency(parseFloat(lic.montoPresupuestado))}
                      </p>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-700 bg-slate-800/50">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-red-500" />
              <CardTitle className="text-white text-base">Alertas de Seguridad</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentAlerts?.length === 0 ? (
                <div className="flex items-center gap-3 p-4 bg-emerald-900/20 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-emerald-500" />
                  <p className="text-sm text-emerald-400">Sin alertas pendientes</p>
                </div>
              ) : (
                recentAlerts?.map((alerta: any) => (
                  <div key={alerta.id} className="p-3 bg-slate-700/50 rounded-lg border-l-4 border-red-500">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={`text-xs ${getSeveridadBadge(alerta.severidad)}`}>{alerta.severidad}</Badge>
                      <span className="text-xs text-slate-500">{alerta.codigo}</span>
                    </div>
                    <p className="text-sm text-slate-300">{alerta.descripcion}</p>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
