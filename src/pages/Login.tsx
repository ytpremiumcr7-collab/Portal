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
    <div className="flex min-h-screen bg-slate-100">
      <div className="relative hidden w-[42%] flex-col justify-between ares-gov-header px-10 py-12 lg:flex">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded border border-white/20 bg-white/10">
              <Shield className="h-5 w-5 text-emerald-300" />
            </div>
            <div>
              <p className="text-lg font-semibold tracking-wide">ARES</p>
              <p className="text-[11px] uppercase tracking-wider text-slate-300">
                Sistema de adquisiciones
              </p>
            </div>
          </div>
          <div className="mt-16 max-w-sm space-y-4">
            <h1 className="text-2xl font-semibold leading-snug">
              Portal institucional de contratación pública
            </h1>
            <p className="text-sm leading-relaxed text-slate-300">
              Gestión formal de procedimientos de adquisición, expediente electrónico,
              segregación de funciones y consulta pública, conforme al marco normativo
              aplicable en los Estados Unidos Mexicanos.
            </p>
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Uso exclusivo de personal autorizado. Toda operación queda registrada en bitácora.
        </p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6 space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">Acceso al sistema</h2>
            <p className="text-sm text-slate-600">
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
              <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {login.error.message}
              </div>
            )}

            <Button type="submit" disabled={login.isPending} className="ares-cta w-full">
              {login.isPending ? "Validando credenciales…" : "Iniciar sesión"}
            </Button>
          </form>

          <div className="mt-6 space-y-3 border-t border-slate-200 pt-5 text-center text-sm text-slate-600">
            <p>
              <Link to="/portal" className="font-medium text-[hsl(222_47%_28%)] underline">
                Portal público
              </Link>
              {" · "}
              <Link to="/consulta-publica" className="underline">
                Consulta pública
              </Link>
            </p>
            <p>
              ¿Primera configuración?{" "}
              <Link to="/registro" className="font-medium text-[hsl(222_47%_28%)] underline">
                Registrar organización
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
