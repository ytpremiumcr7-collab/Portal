import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Shield } from "lucide-react";

export default function BuscadorPublico() {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const { data, isFetching } = trpc.consultaPublica.procedimientos.useQuery(
    { q: term || undefined, pageSize: 30 },
    { enabled: term.length >= 2 },
  );

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="ares-gov-header">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-emerald-300" />
            <p className="font-semibold">Buscador público</p>
          </div>
          <Button asChild variant="secondary" size="sm" className="bg-white text-slate-900">
            <Link to="/portal">Portal</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <form
          className="ares-panel flex gap-2 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(q.trim());
          }}
        >
          <Input
            className="ares-input"
            placeholder="Buscar por código o título…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button type="submit" className="ares-cta">Buscar</Button>
        </form>
        {isFetching && <p className="mt-4 text-sm text-slate-500">Buscando…</p>}
        <ul className="mt-4 space-y-2">
          {data?.items?.map((r: any) => (
            <li key={r.id} className="ares-panel px-4 py-3">
              <Link to={`/consulta-publica?id=${r.id}`} className="font-medium text-slate-900 underline">
                {r.codigo} — {r.titulo}
              </Link>
              <p className="text-xs text-slate-500">{r.estado} · {r.tipoLicitacion}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
