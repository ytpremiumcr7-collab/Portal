import { Link } from "react-router";
import { Shield, Search, FileText, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/const";

export default function PortalPublico() {
  return (
    <div className="min-h-screen bg-[hsl(210_20%_97%)]">
      <header className="ares-gov-header">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-emerald-300" />
            <div>
              <p className="text-lg font-semibold tracking-wide">{PRODUCT_NAME}</p>
              <p className="text-[11px] uppercase tracking-wider text-slate-300">
                {PRODUCT_TAGLINE}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="secondary" size="sm" className="bg-white text-slate-900 hover:bg-slate-100">
              <Link to="/convocatorias">Convocatorias</Link>
            </Button>
            <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500">
              <Link to="/login">Acceso al sistema</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-12">
        <section className="mb-10 max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Transparencia y formalidad en la contratación pública
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            Consulte convocatorias publicadas, procedimientos en curso, adjudicaciones y
            contratos formales. Este portal opera conforme al marco normativo aplicable
            (LAASSP / LOPSRM) y conserva expediente electrónico con trazabilidad.
          </p>
        </section>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { to: "/convocatorias", icon: FileText, title: "Convocatorias", desc: "Procedimientos publicados abiertos a consulta." },
            { to: "/licitaciones-publicas", icon: Scale, title: "Licitaciones públicas", desc: "Listado formal de procedimientos." },
            { to: "/buscador", icon: Search, title: "Buscador", desc: "Búsqueda por clave, objeto o estado." },
            { to: "/consulta-publica", icon: Shield, title: "Consulta pública", desc: "Datos abiertos, sanciones e OCDS." },
          ].map((c) => (
            <Link key={c.to} to={c.to} className="ares-panel p-5 transition hover:border-slate-300 hover:bg-slate-50">
              <c.icon className="mb-3 h-5 w-5 text-[hsl(222_47%_20%)]" />
              <h2 className="text-sm font-semibold text-slate-900">{c.title}</h2>
              <p className="mt-1 text-xs text-slate-500">{c.desc}</p>
            </Link>
          ))}
        </div>

        <p className="mt-12 text-center text-[11px] text-slate-500">
          Gobierno de México · Contratación pública · Toda operación autenticada queda en bitácora de auditoría
        </p>
      </main>
    </div>
  );
}
