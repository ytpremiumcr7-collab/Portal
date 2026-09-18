import { Routes, Route } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/ares/AppLayout";
import Dashboard from "@/pages/Dashboard";
import Licitaciones from "@/pages/Licitaciones";
import LicitacionDetalle from "@/pages/LicitacionDetalle";
import NuevaLicitacion from "@/pages/NuevaLicitacion";
import Proveedores from "@/pages/Proveedores";
import Entidades from "@/pages/Entidades";
import Alertas from "@/pages/Alertas";
import Login from "@/pages/Login";
import Registro from "@/pages/Registro";
import NotFound from "@/pages/NotFound";
import Documentos from "@/pages/Documentos";
import Hitos from "@/pages/Hitos";
import Auditoria from "@/pages/Auditoria";
import Usuarios from "@/pages/Usuarios";
import Expedientes from "@/pages/Expedientes";
import ExpedienteDetalle from "@/pages/ExpedienteDetalle";
import Aclaraciones from "@/pages/Aclaraciones";
import Aperturas from "@/pages/Aperturas";
import Dictamenes from "@/pages/Dictamenes";
import Fallos from "@/pages/Fallos";
import Contratos from "@/pages/Contratos";
import Garantias from "@/pages/Garantias";

function RoleGate({ roles, children }: { roles: Array<"admin" | "licitante" | "proveedor">; children: React.ReactNode }) {
  const { user, isLoading } = useAuth({ redirectOnUnauthenticated: true });
  if (isLoading || !user) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">Validando sesión…</div>;
  if (!roles.includes(user.role)) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-red-400">No tienes permisos para acceder a este módulo.</div>;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/registro" element={<Registro />} />
      <Route path="*" element={
        <AppLayout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/licitaciones" element={<Licitaciones />} />
            <Route path="/licitaciones/nueva" element={<RoleGate roles={["admin","licitante"]}><NuevaLicitacion /></RoleGate>} />
            <Route path="/licitaciones/:id" element={<LicitacionDetalle />} />
            <Route path="/proveedores" element={<Proveedores />} />
            <Route path="/entidades" element={<RoleGate roles={["admin","licitante"]}><Entidades /></RoleGate>} />
            <Route path="/alertas" element={<RoleGate roles={["admin","licitante"]}><Alertas /></RoleGate>} />
            <Route path="/expedientes" element={<RoleGate roles={["admin","licitante"]}><Expedientes /></RoleGate>} />
            <Route path="/expedientes/:id" element={<RoleGate roles={["admin","licitante"]}><ExpedienteDetalle /></RoleGate>} />
            <Route path="/documentos" element={<Documentos />} />
            <Route path="/hitos" element={<RoleGate roles={["admin","licitante"]}><Hitos /></RoleGate>} />
            <Route path="/aclaraciones" element={<RoleGate roles={["admin","licitante","proveedor"]}><Aclaraciones /></RoleGate>} />
            <Route path="/aperturas" element={<RoleGate roles={["admin","licitante"]}><Aperturas /></RoleGate>} />
            <Route path="/dictamenes" element={<RoleGate roles={["admin","licitante"]}><Dictamenes /></RoleGate>} />
            <Route path="/fallos" element={<RoleGate roles={["admin","licitante"]}><Fallos /></RoleGate>} />
            <Route path="/contratos" element={<RoleGate roles={["admin","licitante"]}><Contratos /></RoleGate>} />
            <Route path="/garantias" element={<RoleGate roles={["admin","licitante"]}><Garantias /></RoleGate>} />
            <Route path="/auditoria" element={<RoleGate roles={["admin"]}><Auditoria /></RoleGate>} />
            <Route path="/usuarios" element={<RoleGate roles={["admin"]}><Usuarios /></RoleGate>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppLayout>
      } />
    </Routes>
  );
}
