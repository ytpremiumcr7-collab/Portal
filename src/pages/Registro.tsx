import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield } from "lucide-react";
import { PRODUCT_NAME } from "@/const";

const fields = [
  {
    key: "tenantNombre" as const,
    label: "Nombre de la organización",
    help: "Razón social o denominación de la entidad contratante.",
    type: "text",
  },
  {
    key: "tenantRfc" as const,
    label: "RFC de la organización",
    help: "Registro Federal de Contribuyentes (12 o 13 caracteres).",
    type: "text",
  },
  {
    key: "name" as const,
    label: "Nombre del administrador",
    help: "Titular de la primera cuenta con privilegios de administración.",
    type: "text",
  },
  {
    key: "email" as const,
    label: "Correo electrónico",
    help: "Correo oficial del administrador.",
    type: "email",
  },
  {
    key: "password" as const,
    label: "Contraseña",
    help: "Mínimo 12 caracteres. Conserve la contraseña en un gestor seguro.",
    type: "password",
  },
];

export default function Registro() {
  const navigate = useNavigate();
  const [f, setF] = useState({
    tenantNombre: "",
    tenantRfc: "",
    name: "",
    email: "",
    password: "",
  });
  const register = trpc.auth.register.useMutation({ onSuccess: () => navigate("/") });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    register.mutate(f);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-xl rounded-md border border-slate-300 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-slate-300 bg-slate-50">
            <Shield className="h-5 w-5 text-slate-700" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Registro de organización</h1>
            <p className="mt-1 text-sm text-slate-600">
              Alta inicial de una organización mexicana y de su cuenta administradora
              en {PRODUCT_NAME}.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key} className="ares-label ares-required">
                {field.label}
              </Label>
              <Input
                id={field.key}
                type={field.type}
                value={f[field.key]}
                onChange={(e) => set(field.key, e.target.value)}
                required
                className="ares-input"
              />
              <p className="ares-help">{field.help}</p>
            </div>
          ))}

          {register.error && (
            <div
              role="alert"
              className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {register.error.message}
            </div>
          )}

          <div className="flex flex-wrap gap-3 pt-2">
            <Button type="submit" disabled={register.isPending} className="ares-cta">
              {register.isPending ? "Registrando…" : "Crear organización"}
            </Button>
            <Link to="/login">
              <Button type="button" variant="outline" className="border-slate-600 text-slate-700">
                Volver al acceso
              </Button>
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
