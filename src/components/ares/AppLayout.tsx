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
  MessagesSquare,
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
  Landmark,
  Briefcase,
  Dices,
  KeyRound,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { PRODUCT_NAME } from "@/const";

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

/** Four IA worlds: público (always linked), licitante, dependencia, auditoría */
const navGroups: NavGroup[] = [
  {
    id: "portal",
    label: "Portal público",
    items: [
      { path: "/portal", label: "Inicio público", icon: Landmark, roles: ["admin", "licitante", "proveedor"] },
      { path: "/convocatorias", label: "Convocatorias", icon: Globe, roles: ["admin", "licitante", "proveedor"] },
      { path: "/consulta-publica", label: "Consulta pública", icon: Search, roles: ["admin", "licitante", "proveedor"] },
    ],
  },
  {
    id: "licitante",
    label: "Área proveedor",
    items: [
      { path: "/oportunidades", label: "Oportunidades", icon: Briefcase, roles: ["proveedor"] },
      { path: "/presentar-propuesta", label: "Presentar propuesta", icon: FileText, roles: ["proveedor"] },
      { path: "/mis-proposiciones", label: "Mis proposiciones", icon: ScrollText, roles: ["proveedor"] },
      { path: "/documentos", label: "Documentos", icon: ScrollText, roles: ["admin", "licitante", "proveedor"] },
      { path: "/notificaciones", label: "Comunicaciones", icon: Bell, roles: ["admin", "licitante", "proveedor"] },
      { path: "/consorcios", label: "Consorcios", icon: Users, roles: ["proveedor"] },
      { path: "/inconformidades", label: "Inconformidades", icon: FileWarning, roles: ["admin", "licitante", "proveedor"] },
    ],
  },
  {
    id: "dependencia",
    label: "Área dependencia",
    items: [
      { path: "/", label: "Tablero", icon: LayoutDashboard, roles: ["admin", "licitante"] },
      { path: "/planeacion", label: "Planeación", icon: ClipboardList, roles: ["admin", "licitante"] },
      { path: "/investigacion-mercado", label: "Investigación de mercado", icon: Search, roles: ["admin", "licitante"] },
      { path: "/licitaciones", label: "Procedimientos", icon: FileText, roles: ["admin", "licitante", "proveedor"] },
      { path: "/aclaraciones", label: "Junta de aclaraciones", icon: MessageSquare, roles: ["admin", "licitante", "proveedor"] },
      { path: "/dialogo", label: "Diálogo competitivo", icon: MessagesSquare, roles: ["admin", "licitante"] },
      { path: "/aperturas", label: "Apertura", icon: PackageOpen, roles: ["admin", "licitante"] },
      { path: "/dictamenes", label: "Evaluación / dictamen", icon: Scale, roles: ["admin", "licitante"] },
      { path: "/fallos", label: "Fallo", icon: Gavel, roles: ["admin", "licitante"] },
      { path: "/desempate", label: "Desempate", icon: Dices, roles: ["admin", "licitante"] },
      { path: "/acto-adjudicacion", label: "Acto de adjudicación", icon: Gavel, roles: ["admin", "licitante"] },
      { path: "/comision", label: "Comisión / COI", icon: Users, roles: ["admin", "licitante"] },
      { path: "/terminacion", label: "Cancelación / desierto", icon: Ban, roles: ["admin", "licitante"] },
      { path: "/calendario", label: "Calendario jurídico", icon: ClipboardList, roles: ["admin", "licitante"] },
      { path: "/consorcios", label: "Consorcios (validación)", icon: Users, roles: ["admin", "licitante"] },
      { path: "/contratos", label: "Adjudicación / contrato", icon: FileSignature, roles: ["admin", "licitante"] },
      { path: "/garantias", label: "Garantías", icon: ShieldCheck, roles: ["admin", "licitante"] },
      { path: "/ejecucion", label: "Ejecución", icon: Wrench, roles: ["admin", "licitante"] },
      { path: "/pagos", label: "Pagos", icon: Banknote, roles: ["admin", "licitante"] },
      { path: "/entidades", label: "Entidades", icon: Building2, roles: ["admin", "licitante"] },
      { path: "/proveedores", label: "Proveedores", icon: Users, roles: ["admin", "licitante", "proveedor"] },
      { path: "/incidencias", label: "Incidencias", icon: AlertCircle, roles: ["admin", "licitante"] },
      { path: "/sanciones", label: "Sanciones", icon: Ban, roles: ["admin", "licitante"] },
      { path: "/alertas", label: "Alertas de integridad", icon: AlertTriangle, roles: ["admin", "licitante"] },
    ],
  },
  {
    id: "auditoria",
    label: "Auditoría",
    items: [
      { path: "/expedientes", label: "Expedientes / trazabilidad", icon: FolderOpen, roles: ["admin", "licitante"] },
      { path: "/hitos", label: "Hitos / evidencias", icon: AlertTriangle, roles: ["admin", "licitante"] },
      { path: "/auditoria", label: "Bitácora de eventos", icon: Shield, roles: ["admin"] },
      { path: "/sod", label: "Segregación de funciones", icon: SplitSquareVertical, roles: ["admin"] },
      { path: "/capabilities", label: "Capacidades", icon: KeyRound, roles: ["admin"] },
      { path: "/smtp", label: "SMTP / outbox", icon: Mail, roles: ["admin"] },
      { path: "/usuarios", label: "Usuarios", icon: Users, roles: ["admin"] },
    ],
  },
];

const roleLabel: Record<string, string> = {
  admin: "Administrador",
  licitante: "Dependencia / área contratante",
  proveedor: "Licitante / proveedor",
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
        "group flex items-center gap-2.5 rounded px-2.5 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "border-l-[3px] border-emerald-400 bg-white/10 text-white pl-[7px]"
          : "border-l-[3px] border-transparent text-slate-300 hover:bg-white/5 hover:text-white",
      )}
    >
      <item.icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          active ? "text-emerald-300" : "text-slate-400 group-hover:text-slate-200",
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
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-600">
        Validando sesión…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-900">
      <aside className="fixed hidden h-full w-64 flex-col bg-[hsl(222_47%_16%)] text-white lg:flex">
        <div className="ares-gov-header flex items-center gap-3 px-4 py-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded border border-white/20 bg-white/10">
            <Shield className="text-emerald-300" style={{ width: 18, height: 18 }} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-wide">{PRODUCT_NAME}</p>
            <p className="truncate text-[10px] uppercase tracking-wider text-slate-300">
              Contratación pública · MX
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-3">
          {filteredGroups.map((group) => (
            <div key={group.id} className="mb-3">
              <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
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

        <div className="border-t border-white/10 p-3">
          <div className="mb-2 flex items-center gap-2.5 px-1">
            <div className="flex h-8 w-8 items-center justify-center rounded border border-white/20 bg-white/10 text-xs font-semibold">
              {(user.name ?? "U").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-[11px] text-slate-400">{roleLabel[user.role] ?? user.role}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-slate-300 hover:bg-red-900/40 hover:text-red-200"
            onClick={() => logout()}
          >
            <LogOut className="mr-2 h-3.5 w-3.5" />
            Cerrar sesión
          </Button>
        </div>
      </aside>

      <div className="fixed left-0 right-0 top-0 z-50 ares-gov-header lg:hidden">
        <div className="flex items-center justify-between px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <Shield className="h-4 w-4 text-emerald-300" />
            <div>
              <p className="text-sm font-semibold">{PRODUCT_NAME}</p>
              <p className="text-[10px] uppercase tracking-wider text-slate-300">Contratación pública</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="text-white" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
        {mobileOpen && (
          <nav className="max-h-[75vh] overflow-y-auto border-t border-white/10 bg-[hsl(222_47%_14%)] px-2.5 py-3">
            {filteredGroups.map((group) => (
              <div key={group.id} className="mb-3">
                <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink key={item.path} item={item} active={isActive(item.path)} onNavigate={() => setMobileOpen(false)} />
                  ))}
                </div>
              </div>
            ))}
          </nav>
        )}
      </div>

      <main className="flex-1 pt-14 lg:ml-64 lg:pt-0">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-6">{children}</div>
      </main>
    </div>
  );
}
