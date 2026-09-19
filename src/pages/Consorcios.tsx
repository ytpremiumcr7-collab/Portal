import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";

export default function Consorcios() {
  const [nombre, setNombre] = useState("");
  const [rfc, setRfc] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [proveedorId, setProveedorId] = useState("");
  const [rol, setRol] = useState<"LIDER" | "MIEMBRO">("MIEMBRO");
  const [pct, setPct] = useState("");
  const [partId, setPartId] = useState("");
  const list = trpc.consorcios.list.useQuery();
  const detail = trpc.consorcios.get.useQuery({ id: selected! }, { enabled: !!selected });
  const crear = trpc.consorcios.crear.useMutation({ onSuccess: () => list.refetch() });
  const add = trpc.consorcios.agregarMiembro.useMutation({ onSuccess: () => detail.refetch() });
  const activar = trpc.consorcios.activar.useMutation({ onSuccess: () => { list.refetch(); detail.refetch(); } });
  const vincular = trpc.consorcios.vincularParticipacion.useMutation();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Consorcios"
        description="El proveedor crea y administra el consorcio; la convocante sólo valida y vincula a la participación."
        breadcrumbs={[{ label: "Área proveedor" }, { label: "Consorcios" }]}
      />
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 px-4 py-3"><CardTitle className="text-sm font-semibold">Nuevo consorcio</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <div className="space-y-1"><Label className="text-xs">Nombre</Label><Input value={nombre} onChange={(e) => setNombre(e.target.value)} className="min-w-[14rem]" /></div>
          <div className="space-y-1"><Label className="text-xs">RFC líder</Label><Input value={rfc} onChange={(e) => setRfc(e.target.value)} className="w-40" /></div>
          <Button className="self-end" disabled={nombre.length < 3 || crear.isPending}
            onClick={() => crear.mutate({ nombre, rfcLider: rfc || undefined, motivo: "Alta de consorcio" })}>Crear</Button>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 px-4 py-3"><CardTitle className="text-sm font-semibold">Consorcios</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-500">
                <th className="p-3">ID</th><th className="p-3">Nombre</th><th className="p-3">Estado</th>
              </tr></thead>
              <tbody>
                {(list.data ?? []).map((c: any) => (
                  <tr key={c.id} className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${selected === c.id ? "bg-slate-50" : ""}`}
                    onClick={() => setSelected(c.id)}>
                    <td className="p-3">{c.id}</td>
                    <td className="p-3">{c.nombre}</td>
                    <td className="p-3"><StatusBadge status={c.estado} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 px-4 py-3">
            <CardTitle className="text-sm font-semibold">Detalle {selected ? `#${selected}` : ""}</CardTitle>
            {detail.data?.estado === "BORRADOR" && (
              <Button size="sm" onClick={() => activar.mutate({ id: selected!, motivo: "Activación de consorcio" })}>Activar</Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            {!selected && <p className="text-sm text-slate-500">Seleccione un consorcio.</p>}
            {detail.data && (
              <>
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-500">
                    <th className="p-2">Proveedor</th><th className="p-2">Rol</th><th className="p-2">%</th>
                  </tr></thead>
                  <tbody>
                    {(detail.data.miembros ?? []).map((m: any) => (
                      <tr key={m.id} className="border-b border-slate-100">
                        <td className="p-2">{m.proveedorId}</td><td className="p-2">{m.rol}</td><td className="p-2">{m.porcentajeParticipacion ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  <Input placeholder="Proveedor ID" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className="w-28" />
                  <select className="h-9 rounded border px-2 text-sm" value={rol} onChange={(e) => setRol(e.target.value as any)}>
                    <option value="LIDER">LÍDER</option><option value="MIEMBRO">MIEMBRO</option>
                  </select>
                  <Input placeholder="% part." value={pct} onChange={(e) => setPct(e.target.value)} className="w-24" />
                  <Button size="sm" disabled={!proveedorId || add.isPending}
                    onClick={() => add.mutate({
                      consorcioId: selected!, proveedorId: Number(proveedorId), rol,
                      porcentajeParticipacion: pct || undefined, motivo: "Alta de miembro de consorcio",
                    })}>Agregar</Button>
                </div>
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  <Input placeholder="Participación ID" value={partId} onChange={(e) => setPartId(e.target.value)} className="w-36" />
                  <Button size="sm" disabled={!partId || vincular.isPending}
                    onClick={() => vincular.mutate({
                      consorcioId: selected!, participacionId: Number(partId),
                      motivo: "Vínculo consorcio–participación/proposición",
                    })}>Vincular a participación</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
