import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield } from "lucide-react";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/const";

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"email" | "rfc">("email");
  const [email, setEmail] = useState("");
  const [rfc, setRfc] = useState("");
  const [password, setPassword] = useState("");
  const [memberships, setMemberships] = useState<Array<{ tenantId: number; tenantNombre: string }>>([]);
  const login = trpc.auth.login.useMutation({
    onSuccess: () => navigate("/"),
  });
  const loginByRfc = trpc.auth.loginByRfc.useMutation({
    onSuccess: (res) => {
      if (res.requiresTenantSelection) {
        setMemberships(res.memberships ?? []);
        return;
      }
      navigate("/");
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "rfc") loginByRfc.mutate({ rfc, password });
    else login.mutate({ email, password });
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
              <p className="text-lg font-semibold tracking-wide">{PRODUCT_NAME}</p>
              <p className="text-[11px] uppercase tracking-wider text-slate-300">
                Contratación pública
              </p>
            </div>
          </div>
          <div className="mt-16 max-w-sm space-y-4">
            <h1 className="text-2xl font-semibold leading-snug">
              {PRODUCT_TAGLINE}
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
        <div className="w-full max-w-md rounded border border-slate-300 bg-white p-6 shadow-sm ring-1 ring-slate-900/5 sm:p-8">
          <div className="mb-6 space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Acceso al sistema</h2>
            <p className="text-sm text-slate-600">
              Ingrese con las credenciales oficiales de su organización.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="flex gap-2 text-xs">
              <button type="button" className={`rounded border px-2 py-1 ${mode === "email" ? "border-emerald-600 text-emerald-700" : "border-slate-300 text-slate-500"}`} onClick={() => setMode("email")}>Correo</button>
              <button type="button" className={`rounded border px-2 py-1 ${mode === "rfc" ? "border-emerald-600 text-emerald-700" : "border-slate-300 text-slate-500"}`} onClick={() => setMode("rfc")}>RFC licitante</button>
            </div>
            {mode === "rfc" ? (
            <div className="space-y-1.5">
              <Label htmlFor="rfc" className="ares-label ares-required">RFC</Label>
              <Input id="rfc" value={rfc} onChange={(e) => setRfc(e.target.value.toUpperCase())} required className="ares-input" placeholder="XAXX010101000" />
            </div>
            ) : (
            <div className="space-y-1.5">
              <Label htmlFor="email" className="ares-label ares-required">
                Correo electrónico oficial
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
            )}
            {memberships.length > 0 && (
              <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="font-medium text-amber-900">Seleccione organización</p>
                {memberships.map((m) => (
                  <Button key={m.tenantId} type="button" variant="outline" className="w-full justify-start" onClick={() => loginByRfc.mutate({ rfc, password, tenantId: m.tenantId })}>
                    {m.tenantNombre} (#{m.tenantId})
                  </Button>
                ))}
              </div>
            )}
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

            <Button type="submit" disabled={(login.isPending || loginByRfc.isPending)} className="ares-cta w-full">
              {(login.isPending || loginByRfc.isPending) ? "Validando credenciales…" : "Iniciar sesión"}
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
