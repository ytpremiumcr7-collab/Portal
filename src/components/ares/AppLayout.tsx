import { Link, useLocation } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import {
  Shield,
  LayoutDashboard,
  FileText,
  Users,
  Building2,
  AlertTriangle,
  LogOut,
  Menu,
  X,
  MessageSquare,
  PackageOpen,
  Scale,
  Gavel,
  FileSignature,
  ShieldCheck,
  ClipboardList,
  Search,
  Wrench,
  Banknote,
  AlertCircle,
  Ban,
  FileWarning,
  Bell,
  Globe,
  SplitSquareVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["admin","licitante","proveedor"] },
  { path: "/licitaciones", label: "Licitaciones", icon: FileText, roles: ["admin","licitante","proveedor"] },
  { path: "/proveedores", label: "Proveedores", icon: Users, roles: ["admin","licitante","proveedor"] },
  { path: "/entidades", label: "Entidades", icon: Building2, roles: ["admin","licitante"] },
  { path: "/expedientes", label: "Expedientes electrónicos", icon: FileText, roles: ["admin","licitante"] },
  { path: "/documentos", label: "Documentos", icon: FileText, roles: ["admin","licitante","proveedor"] },
  { path: "/hitos", label: "Hitos", icon: AlertTriangle, roles: ["admin","licitante"] },
  { path: "/aclaraciones", label: "Aclaraciones", icon: MessageSquare, roles: ["admin","licitante","proveedor"] },
  { path: "/aperturas", label: "Aperturas", icon: PackageOpen, roles: ["admin","licitante"] },
  { path: "/dictamenes", label: "Dictámenes", icon: Scale, roles: ["admin","licitante"] },
  { path: "/fallos", label: "Fallos", icon: Gavel, roles: ["admin","licitante"] },
  { path: "/contratos", label: "Contratos", icon: FileSignature, roles: ["admin","licitante"] },
  { path: "/garantias", label: "Garantías", icon: ShieldCheck, roles: ["admin","licitante"] },
  { path: "/planeacion", label: "Planeación", icon: ClipboardList, roles: ["admin","licitante"] },
  { path: "/investigacion-mercado", label: "Inv. mercado", icon: Search, roles: ["admin","licitante"] },
  { path: "/ejecucion", label: "Ejecución", icon: Wrench, roles: ["admin","licitante"] },
  { path: "/pagos", label: "Pagos", icon: Banknote, roles: ["admin","licitante"] },
  { path: "/incidencias", label: "Incidencias", icon: AlertCircle, roles: ["admin","licitante"] },
  { path: "/sanciones", label: "Sanciones", icon: Ban, roles: ["admin","licitante"] },
  { path: "/inconformidades", label: "Inconformidades", icon: FileWarning, roles: ["admin","licitante","proveedor"] },
  { path: "/notificaciones", label: "Notificaciones", icon: Bell, roles: ["admin","licitante"] },
  { path: "/consulta-publica", label: "Consulta pública", icon: Globe, roles: ["admin","licitante","proveedor"] },
  { path: "/alertas", label: "Alertas", icon: AlertTriangle, roles: ["admin","licitante"] },
  { path: "/auditoria", label: "Bitácora", icon: Shield, roles: ["admin"] },
  { path: "/sod", label: "SoD / roles", icon: SplitSquareVertical, roles: ["admin"] },
  { path: "/usuarios", label: "Usuarios", icon: Users, roles: ["admin"] },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, isLoading } = useAuth({ redirectOnUnauthenticated: true });
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  if (isLoading || !user) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">Validando sesión…</div>;

  return (
    <div className="min-h-screen bg-slate-900 flex">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex flex-col w-64 bg-slate-800 border-r border-slate-700 fixed h-full">
        <div className="p-4 flex items-center gap-3 border-b border-slate-700">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Ares Engine</h1>
            <p className="text-xs text-slate-400">Sistema de Licitaciones</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.filter(item => item.roles.includes(user.role)).map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-amber-500/20 text-amber-400"
                    : "text-slate-300 hover:bg-slate-700 hover:text-white"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center">
              <span className="text-xs font-bold text-white">
                {user?.name?.charAt(0) || "U"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{user?.name || "Usuario"}</p>
              <p className="text-xs text-slate-400">{user?.role || "user"}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-slate-400 hover:text-red-400 hover:bg-red-500/10"
            onClick={() => logout()}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Cerrar Sesion
          </Button>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-base font-bold text-white">Ares Engine</h1>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-slate-300"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
        </div>

        {mobileOpen && (
          <nav className="p-3 space-y-1 border-t border-slate-700">
            {navItems.filter(item => item.roles.includes(user.role)).map((item) => {
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? "bg-amber-500/20 text-amber-400"
                      : "text-slate-300 hover:bg-slate-700 hover:text-white"
                  }`}
                  onClick={() => setMobileOpen(false)}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-slate-400 hover:text-red-400 hover:bg-red-500/10 mt-2"
              onClick={() => { logout(); setMobileOpen(false); }}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Cerrar Sesion
            </Button>
          </nav>
        )}
      </div>

      {/* Main Content */}
      <main className="flex-1 lg:ml-64 pt-14 lg:pt-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
