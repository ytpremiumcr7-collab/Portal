import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield } from "lucide-react";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = trpc.auth.login.useMutation({
    onSuccess: () => navigate("/"),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
  };

  return (
    <div className="flex min-h-screen bg-slate-950">
      {/* Institutional brand panel */}
      <div className="relative hidden w-[42%] flex-col justify-between border-r border-slate-800 bg-slate-900 px-10 py-12 lg:flex">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded border border-slate-700 bg-slate-950">
              <Shield className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-lg font-semibold tracking-wide text-slate-50">ARES</p>
              <p className="text-[11px] uppercase tracking-wider text-slate-500">
                Sistema de adquisiciones
              </p>
            </div>
          </div>
          <div className="mt-16 max-w-sm space-y-4">
            <h1 className="text-2xl font-semibold leading-snug text-slate-50">
              Portal institucional de contratación pública
            </h1>
            <p className="text-sm leading-relaxed text-slate-400">
              Plataforma de gestión de procedimientos de adquisición, expediente
              electrónico, segregación de funciones y consulta pública, conforme
              al marco normativo aplicable en los Estados Unidos Mexicanos.
            </p>
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-600">
          Uso exclusivo de personal autorizado de la organización contratante y
          de proveedores registrados. Toda operación queda registrada en bitácora
          de auditoría.
        </p>
      </div>

      {/* Form */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <div className="flex h-10 w-10 items-center justify-center rounded border border-slate-700 bg-slate-900">
            <Shield className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <p className="text-base font-semibold text-slate-50">ARES</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Adquisiciones · México
            </p>
          </div>
        </div>

        <div className="w-full max-w-md rounded-md border border-slate-800 bg-slate-900/80 p-6 shadow-sm sm:p-8">
          <div className="mb-6 space-y-1">
            <h2 className="text-lg font-semibold text-slate-50">Acceso al sistema</h2>
            <p className="text-sm text-slate-400">
              Ingrese con las credenciales institucionales de su organización.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="ares-label ares-required">
                Correo electrónico institucional
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="ares-input"
                placeholder="nombre@entidad.gob.mx"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="ares-label ares-required">
                Contraseña
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="ares-input"
              />
              <p className="ares-help">No comparta su contraseña. El acceso es personal e intransferible.</p>
            </div>

            {login.error && (
              <div
                role="alert"
                className="rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300"
              >
                {login.error.message}
              </div>
            )}

            <Button
              type="submit"
              disabled={login.isPending}
              className="ares-cta w-full"
            >
              {login.isPending ? "Validando credenciales…" : "Iniciar sesión"}
            </Button>
          </form>

          <div className="mt-6 space-y-3 border-t border-slate-800 pt-5 text-center text-sm text-slate-400">
            <p>
              ¿Primera configuración de la organización?{" "}
              <Link to="/registro" className="font-medium text-amber-500 hover:text-amber-400">
                Registrar organización
              </Link>
            </p>
            <p>
              <Link to="/consulta-publica" className="text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline">
                Consulta pública de procedimientos
              </Link>
            </p>
          </div>
        </div>

        <p className="mt-8 max-w-md text-center text-[11px] text-slate-600">
          ARES — Administración de Recursos y Expedientes de Suministro. Uso
          sujeto a políticas internas de la entidad contratante.
        </p>
      </div>
    </div>
  );
}
