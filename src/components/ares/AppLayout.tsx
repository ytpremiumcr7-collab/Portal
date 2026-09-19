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
  FolderOpen,
  ScrollText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type NavItem = {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: string[];
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    id: "inicio",
    label: "Inicio",
    items: [
      { path: "/", label: "Tablero ejecutivo", icon: LayoutDashboard, roles: ["admin", "licitante", "proveedor"] },
    ],
  },
  {
    id: "planeacion",
    label: "Planeación",
    items: [
      { path: "/planeacion", label: "Necesidades", icon: ClipboardList, roles: ["admin", "licitante"] },
      { path: "/investigacion-mercado", label: "Investigación de mercado", icon: Search, roles: ["admin", "licitante"] },
      { path: "/entidades", label: "Entidades contratantes", icon: Building2, roles: ["admin", "licitante"] },
      { path: "/proveedores", label: "Proveedores", icon: Users, roles: ["admin", "licitante", "proveedor"] },
    ],
  },
  {
    id: "procedimiento",
    label: "Procedimiento",
    items: [
      { path: "/licitaciones", label: "Licitaciones", icon: FileText, roles: ["admin", "licitante", "proveedor"] },
      { path: "/expedientes", label: "Expedientes electrónicos", icon: FolderOpen, roles: ["admin", "licitante"] },
      { path: "/documentos", label: "Documentos", icon: ScrollText, roles: ["admin", "licitante", "proveedor"] },
      { path: "/hitos", label: "Hitos del procedimiento", icon: AlertTriangle, roles: ["admin", "licitante"] },
      { path: "/aclaraciones", label: "Junta de aclaraciones", icon: MessageSquare, roles: ["admin", "licitante", "proveedor"] },
      { path: "/aperturas", label: "Apertura de proposiciones", icon: PackageOpen, roles: ["admin", "licitante"] },
      { path: "/dictamenes", label: "Dictámenes", icon: Scale, roles: ["admin", "licitante"] },
      { path: "/fallos", label: "Fallos", icon: Gavel, roles: ["admin", "licitante"] },
    ],
  },
  {
    id: "contratacion",
    label: "Contratación",
    items: [
      { path: "/contratos", label: "Contratos", icon: FileSignature, roles: ["admin", "licitante"] },
      { path: "/garantias", label: "Garantías", icon: ShieldCheck, roles: ["admin", "licitante"] },
      { path: "/ejecucion", label: "Ejecución contractual", icon: Wrench, roles: ["admin", "licitante"] },
      { path: "/pagos", label: "Pagos y estimaciones", icon: Banknote, roles: ["admin", "licitante"] },
    ],
  },
  {
    id: "cumplimiento",
    label: "Cumplimiento",
    items: [
      { path: "/incidencias", label: "Incidencias", icon: AlertCircle, roles: ["admin", "licitante"] },
      { path: "/sanciones", label: "Sanciones e impedimentos", icon: Ban, roles: ["admin", "licitante"] },
      { path: "/inconformidades", label: "Inconformidades", icon: FileWarning, roles: ["admin", "licitante", "proveedor"] },
      { path: "/alertas", label: "Alertas de integridad", icon: AlertTriangle, roles: ["admin", "licitante"] },
      { path: "/consulta-publica", label: "Consulta pública", icon: Globe, roles: ["admin", "licitante", "proveedor"] },
    ],
  },
  {
    id: "sistema",
    label: "Sistema",
    items: [
      { path: "/notificaciones", label: "Notificaciones", icon: Bell, roles: ["admin", "licitante"] },
      { path: "/auditoria", label: "Bitácora de auditoría", icon: Shield, roles: ["admin"] },
      { path: "/sod", label: "Segregación de funciones", icon: SplitSquareVertical, roles: ["admin"] },
      { path: "/usuarios", label: "Usuarios y roles", icon: Users, roles: ["admin"] },
    ],
  },
];

const roleLabel: Record<string, string> = {
  admin: "Administrador",
  licitante: "Área contratante",
  proveedor: "Proveedor",
};

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={item.path}
      onClick={onNavigate}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "border-l-2 border-amber-500 bg-slate-800/90 text-slate-50 pl-[8px]"
          : "border-l-2 border-transparent text-slate-400 hover:bg-slate-800/50 hover:text-slate-200",
      )}
    >
      <item.icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          active ? "text-amber-500" : "text-slate-500 group-hover:text-slate-300",
        )}
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, isLoading } = useAuth({ redirectOnUnauthenticated: true });
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const filteredGroups = useMemo(() => {
    if (!user) return [];
    return navGroups
      .map((g) => ({
        ...g,
        items: g.items.filter((item) => item.roles.includes(user.role)),
      }))
      .filter((g) => g.items.length > 0);
  }, [user]);

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
        Validando sesión…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      {/* Sidebar desktop */}
      <aside className="fixed hidden h-full w-64 flex-col border-r border-slate-800 bg-slate-950 lg:flex">
        <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded border border-slate-700 bg-slate-900">
            <Shield className="h-4.5 w-4.5 text-amber-500" style={{ width: 18, height: 18 }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-wide text-slate-50">ARES</p>
            <p className="truncate text-[10px] uppercase tracking-wider text-slate-500">
              Adquisiciones · México
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-3">
          {filteredGroups.map((group) => (
            <div key={group.id} className="mb-3">
              <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink key={item.path} item={item} active={isActive(item.path)} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-800 p-3">
          <div className="mb-2 flex items-center gap-2.5 px-1">
            <div className="flex h-8 w-8 items-center justify-center rounded border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-200">
              {(user.name ?? "U").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-100">{user.name}</p>
              <p className="truncate text-[11px] text-slate-500">
                {roleLabel[user.role] ?? user.role}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-slate-400 hover:bg-red-950/40 hover:text-red-300"
            onClick={() => logout()}
          >
            <LogOut className="mr-2 h-3.5 w-3.5" />
            Cerrar sesión
          </Button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="fixed left-0 right-0 top-0 z-50 border-b border-slate-800 bg-slate-950 lg:hidden">
        <div className="flex items-center justify-between px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded border border-slate-700 bg-slate-900">
              <Shield className="h-4 w-4 text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-50">ARES</p>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Adquisiciones</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-slate-300"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        {mobileOpen && (
          <nav className="max-h-[75vh] overflow-y-auto border-t border-slate-800 px-2.5 py-3">
            {filteredGroups.map((group) => (
              <div key={group.id} className="mb-3">
                <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.path}
                      item={item}
                      active={isActive(item.path)}
                      onNavigate={() => setMobileOpen(false)}
                    />
                  ))}
                </div>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full justify-start text-slate-400 hover:bg-red-950/40 hover:text-red-300"
              onClick={() => {
                logout();
                setMobileOpen(false);
              }}
            >
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Cerrar sesión
            </Button>
          </nav>
        )}
      </div>

      <main className="flex-1 pt-14 lg:ml-64 lg:pt-0">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-6">{children}</div>
      </main>
    </div>
  );
}
