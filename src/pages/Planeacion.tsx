import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";
import { EmptyState } from "@/components/ares/EmptyState";
import { ClipboardList } from "lucide-react";

type Tab = "necesidades" | "programas" | "suficiencia" | "estrategia";

export default function Planeacion() {
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<Tab>("necesidades");
  const necesidades = trpc.planeacion.listNecesidades.useQuery({ page, pageSize: 20 });
  const programas = trpc.planeacion.listProgramas.useQuery({ page, pageSize: 20 });
  const crearNec = trpc.planeacion.crearNecesidad.useMutation({ onSuccess: () => necesidades.refetch() });
  const transNec = trpc.planeacion.transicionarNecesidad.useMutation({ onSuccess: () => necesidades.refetch() });
  const crearProg = trpc.planeacion.crearPrograma.useMutation({ onSuccess: () => programas.refetch() });
  const aprobarProg = trpc.planeacion.aprobarPrograma.useMutation({ onSuccess: () => programas.refetch() });
  const agregarPartida = trpc.planeacion.agregarPartida.useMutation({ onSuccess: () => programas.refetch() });
  const solicitarSuf = trpc.planeacion.solicitarSuficiencia.useMutation();
  const otorgarSuf = trpc.planeacion.otorgarSuficiencia.useMutation();
  const definirEst = trpc.planeacion.definirEstrategia.useMutation();
  const vincular = trpc.planeacion.vincularALicitacion.useMutation();

  const [entidadId, setEntidadId] = useState("");
  const [folio, setFolio] = useState("");
  const [titulo, setTitulo] = useState("");
  const [monto, setMonto] = useState("");
  const [progNombre, setProgNombre] = useState("");
  const [progAnio, setProgAnio] = useState(String(new Date().getFullYear()));
  const [partidaProgId, setPartidaProgId] = useState("");
  const [partidaCodigo, setPartidaCodigo] = useState("");
  const [partidaDesc, setPartidaDesc] = useState("");
  const [partidaMonto, setPartidaMonto] = useState("");
  const [sufNecId, setSufNecId] = useState("");
  const [sufPartidaId, setSufPartidaId] = useState("");
  const [sufMonto, setSufMonto] = useState("");
  const [sufId, setSufId] = useState("");
  const [estNecId, setEstNecId] = useState("");
  const [vincNecId, setVincNecId] = useState("");
  const [vincCatId, setVincCatId] = useState("1");

  return (
    <div className="space-y-5">
      <PageHeader title="Planeación" description="Programas, partidas, suficiencia, estrategia y vínculo a procedimiento." breadcrumbs={[{ label: "Planeación" }]} />
      <div className="flex flex-wrap gap-2">
        {(["necesidades", "programas", "suficiencia", "estrategia"] as Tab[]).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>{t}</Button>
        ))}
      </div>

      {tab === "necesidades" && (
        <>
          <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
            <CardHeader className="border-b border-slate-800 px-4 py-3"><CardTitle className="text-sm">Nueva necesidad</CardTitle></CardHeader>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
              <div><Label>Entidad ID</Label><Input value={entidadId} onChange={(e) => setEntidadId(e.target.value)} /></div>
              <div><Label>Folio</Label><Input value={folio} onChange={(e) => setFolio(e.target.value)} /></div>
              <div><Label>Título</Label><Input value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
              <div><Label>Monto estimado</Label><Input value={monto} onChange={(e) => setMonto(e.target.value)} /></div>
              <div className="flex items-end"><Button disabled={crearNec.isPending || !entidadId || !folio || !titulo || !monto}
                onClick={() => crearNec.mutate({ entidadId: Number(entidadId), folio, titulo, descripcion: `${titulo} — necesidad registrada`, justificacion: "Justificación operativa", montoEstimado: monto, tipoContratacion: "BIENES", motivo: "Alta necesidad" })}>Registrar</Button></div>
            </CardContent>
          </Card>
          <Card className="border-slate-700/80 bg-slate-900/70 shadow-none"><CardContent className="p-0">
            <table className="w-full text-sm"><thead><tr className="border-b border-slate-800 text-left text-xs text-slate-500"><th className="p-3">ID</th><th>Folio</th><th>Título</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {(necesidades.data?.items ?? []).map((row: any) => (
                  <tr key={row.id} className="border-b border-slate-800">
                    <td className="p-3">{row.id}</td><td>{row.folio}</td><td>{row.titulo}</td>
                    <td><StatusBadge status={row.estado} /></td>
                    <td className="space-x-1 p-3 text-right">
                      {row.estado === "BORRADOR" && <Button size="sm" onClick={() => transNec.mutate({ id: row.id, to: "EN_REVISION", motivo: "Enviar a revisión" })}>Revisar</Button>}
                      {row.estado === "EN_REVISION" && <Button size="sm" onClick={() => transNec.mutate({ id: row.id, to: "APROBADA", motivo: "Aprobar necesidad" })}>Aprobar</Button>}
                    </td>
                  </tr>
                ))}
                {!(necesidades.data?.items ?? []).length && (
                  <tr><td colSpan={5}><EmptyState title="Sin necesidades" description="Registre la primera necesidad." icon={<ClipboardList className="h-5 w-5" />} /></td></tr>
                )}
              </tbody>
            </table>
          </CardContent></Card>
        </>
      )}

      {tab === "programas" && (
        <>
          <Card className="border-slate-700/80 bg-slate-900/70"><CardContent className="flex flex-wrap gap-3 p-4">
            <div><Label>Entidad ID</Label><Input value={entidadId} onChange={(e) => setEntidadId(e.target.value)} className="max-w-[8rem]" /></div>
            <div><Label>Año</Label><Input value={progAnio} onChange={(e) => setProgAnio(e.target.value)} className="max-w-[6rem]" /></div>
            <div><Label>Nombre</Label><Input value={progNombre} onChange={(e) => setProgNombre(e.target.value)} /></div>
            <Button className="self-end" disabled={!entidadId || !progNombre || crearProg.isPending}
              onClick={() => crearProg.mutate({ entidadId: Number(entidadId), anio: Number(progAnio), nombre: progNombre, motivo: "Alta programa anual" })}>Crear programa</Button>
          </CardContent></Card>
          <Card className="border-slate-700/80 bg-slate-900/70"><CardHeader><CardTitle className="text-sm">Agregar partida</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-3 p-4">
              <Input placeholder="Programa ID" value={partidaProgId} onChange={(e) => setPartidaProgId(e.target.value)} className="max-w-[8rem]" />
              <Input placeholder="Código" value={partidaCodigo} onChange={(e) => setPartidaCodigo(e.target.value)} className="max-w-[8rem]" />
              <Input placeholder="Descripción" value={partidaDesc} onChange={(e) => setPartidaDesc(e.target.value)} />
              <Input placeholder="Monto" value={partidaMonto} onChange={(e) => setPartidaMonto(e.target.value)} className="max-w-[8rem]" />
              <Button disabled={agregarPartida.isPending || !partidaProgId} onClick={() => agregarPartida.mutate({ programaId: Number(partidaProgId), codigo: partidaCodigo, descripcion: partidaDesc || "Partida", montoAsignado: partidaMonto || "0.00", fuenteFinanciamiento: "RECURSOS_FISCALES", motivo: "Alta partida" })}>Agregar</Button>
            </CardContent></Card>
          <Card className="border-slate-700/80 bg-slate-900/70"><CardContent className="p-0">
            <table className="w-full text-sm"><thead><tr className="border-b border-slate-800 text-left text-xs text-slate-500"><th className="p-3">ID</th><th>Nombre</th><th>Año</th><th>Estado</th><th /></tr></thead>
              <tbody>{(programas.data?.items ?? []).map((p: any) => (
                <tr key={p.id} className="border-b border-slate-800"><td className="p-3">{p.id}</td><td>{p.nombre}</td><td>{p.anio}</td><td>{p.estado}</td>
                  <td className="p-3 text-right">{p.estado === "BORRADOR" && <Button size="sm" onClick={() => aprobarProg.mutate({ id: p.id, motivo: "Aprobar programa" })}>Aprobar</Button>}</td></tr>
              ))}</tbody>
            </table>
          </CardContent></Card>
        </>
      )}

      {tab === "suficiencia" && (
        <Card className="border-slate-700/80 bg-slate-900/70"><CardContent className="flex flex-wrap gap-3 p-4">
          <Input placeholder="Necesidad ID" value={sufNecId} onChange={(e) => setSufNecId(e.target.value)} className="max-w-[8rem]" />
          <Input placeholder="Partida ID" value={sufPartidaId} onChange={(e) => setSufPartidaId(e.target.value)} className="max-w-[8rem]" />
          <Input placeholder="Monto" value={sufMonto} onChange={(e) => setSufMonto(e.target.value)} className="max-w-[8rem]" />
          <Button disabled={solicitarSuf.isPending} onClick={() => solicitarSuf.mutate({ necesidadId: Number(sufNecId), partidaId: Number(sufPartidaId), monto: sufMonto, folio: `SUF-${Date.now()}`, motivo: "Solicitud suficiencia" })}>Solicitar</Button>
          <Input placeholder="Suficiencia ID a otorgar" value={sufId} onChange={(e) => setSufId(e.target.value)} className="max-w-[10rem]" />
          <Button disabled={otorgarSuf.isPending} onClick={() => otorgarSuf.mutate({ id: Number(sufId), motivo: "Otorgar suficiencia" })}>Otorgar</Button>
        </CardContent></Card>
      )}

      {tab === "estrategia" && (
        <Card className="border-slate-700/80 bg-slate-900/70"><CardContent className="flex flex-wrap gap-3 p-4">
          <Input placeholder="Necesidad ID (estrategia)" value={estNecId} onChange={(e) => setEstNecId(e.target.value)} className="max-w-[10rem]" />
          <Button disabled={definirEst.isPending} onClick={() => definirEst.mutate({ necesidadId: Number(estNecId), modalidad: "LICITACION_PUBLICA", justificacionModalidad: "Procedimiento abierto conforme a normativa aplicable", procedencia: "Procedente por suficiencia y necesidad aprobada", motivo: "Definir estrategia" })}>Definir estrategia LP</Button>
          <Input placeholder="Necesidad ID (vincular)" value={vincNecId} onChange={(e) => setVincNecId(e.target.value)} className="max-w-[10rem]" />
          <Input placeholder="Categoría ID" value={vincCatId} onChange={(e) => setVincCatId(e.target.value)} className="max-w-[8rem]" />
          <Button disabled={vincular.isPending} onClick={() => vincular.mutate({ necesidadId: Number(vincNecId), categoriaId: Number(vincCatId), motivo: "Vincular a nuevo procedimiento" })}>Vincular a licitación</Button>
        </CardContent></Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
        <Button variant="outline" onClick={() => setPage((p) => p + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}
