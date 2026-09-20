import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus } from "lucide-react";

export default function NuevaLicitacion() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const { data: entidadesPage } = trpc.entidades.list.useQuery();
  const { data: categoriasPage } = trpc.categorias.list.useQuery();

  const [form, setForm] = useState({
    titulo: "",
    objeto: "",
    descripcionDetallada: "",
    entidadId: "",
    categoriaId: "",
    tipoLicitacion: "LICITACION_PUBLICA" as const,
    tipoContratacion: "OBRA" as const,
    montoPresupuestado: "",
    moneda: "MXN" as const,
    fechaPublicacion: "",
    fechaCierre: "",
    criterioEvaluacion: "MEJOR_RELACION_CALIDAD_PRECIO" as const,
    ponderacionTecnica: "40",
    ponderacionEconomica: "60",
    fechaApertura: "",
    modoEvaluacion: "HIBRIDA" as const,
    rubricaTecnica: "",
  });

  const createMutation = trpc.licitaciones.create.useMutation({
    onSuccess: () => {
      utils.licitaciones.list.invalidate();
      navigate("/licitaciones");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      titulo: form.titulo,
      objeto: form.objeto,
      descripcionDetallada: form.descripcionDetallada || undefined,
      entidadId: parseInt(form.entidadId),
      categoriaId: parseInt(form.categoriaId),
      tipoLicitacion: form.tipoLicitacion,
      tipoContratacion: form.tipoContratacion,
      montoPresupuestado: form.montoPresupuestado,
      fechaPublicacion: form.fechaPublicacion || undefined,
      fechaCierre: form.fechaCierre || undefined,
      fechaApertura: form.fechaApertura || undefined,
      modoEvaluacion: form.modoEvaluacion,
      rubricaTecnica: form.rubricaTecnica || undefined,
      criterioEvaluacion: form.criterioEvaluacion,
      ponderacionTecnica: form.ponderacionTecnica,
      ponderacionEconomica: form.ponderacionEconomica,
    });
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link to="/licitaciones">
          <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <h2 className="text-2xl font-bold text-white">Nueva Licitacion</h2>
      </div>

      <Card className="border-slate-700 bg-slate-800/50">
        <form onSubmit={handleSubmit}>
          <CardContent className="p-6 space-y-4">
            <div>
              <Label className="text-slate-300">Titulo *</Label>
              <Input
                required value={form.titulo}
                onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                className="bg-slate-700 border-slate-600 text-white"
                placeholder="Titulo de la licitacion"
              />
            </div>

            <div>
              <Label className="text-slate-300">Objeto *</Label>
              <Textarea
                required value={form.objeto}
                onChange={(e) => setForm({ ...form, objeto: e.target.value })}
                className="bg-slate-700 border-slate-600 text-white"
                placeholder="Descripcion del objeto de la licitacion"
              />
            </div>

            <div>
              <Label className="text-slate-300">Descripcion Detallada</Label>
              <Textarea
                value={form.descripcionDetallada}
                onChange={(e) => setForm({ ...form, descripcionDetallada: e.target.value })}
                className="bg-slate-700 border-slate-600 text-white"
                placeholder="Descripcion ampliada..."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-300">Entidad *</Label>
                <Select value={form.entidadId} onValueChange={(v) => setForm({ ...form, entidadId: v })}>
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                    <SelectValue placeholder="Seleccionar entidad" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-700 border-slate-600">
                    {entidadesPage?.items.map((e: any) => (
                      <SelectItem key={e.id} value={String(e.id)} className="text-white">{e.razonSocial}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-slate-300">Categoria *</Label>
                <Select value={form.categoriaId} onValueChange={(v) => setForm({ ...form, categoriaId: v })}>
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                    <SelectValue placeholder="Seleccionar categoria" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-700 border-slate-600">
                    {categoriasPage?.items.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)} className="text-white">{c.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-slate-300">Modalidad LAASSP art. 35 *</Label>
                <p className="text-[11px] text-slate-500 mb-1">Modalidades IV–VII requieren metadatos (Comité/Hacienda, acuerdo marco u orden) vía setModalidadMeta antes de publicar; el servidor rechaza publicación incompleta.</p>
                <Select value={form.tipoLicitacion} onValueChange={(v) => setForm({ ...form, tipoLicitacion: v as any })}>
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-700 border-slate-600">
                    <SelectItem value="LICITACION_PUBLICA" className="text-white">I — Licitación pública</SelectItem>
                    <SelectItem value="INVITACION_TRES" className="text-white">II — Invitación a cuando menos tres</SelectItem>
                    <SelectItem value="INVITACION_RESTRINGIDA" className="text-white">II (legacy) — Invitación restringida</SelectItem>
                    <SelectItem value="ADJUDICACION_DIRECTA" className="text-white">III — Adjudicación directa</SelectItem>
                    <SelectItem value="DIALOGO_COMPETITIVO" className="text-white">IV — Diálogo competitivo (requiere Comité/Hacienda)</SelectItem>
                    <SelectItem value="ADJUDICACION_DIRECTA_NEGOCIACION" className="text-white">V — AD con negociación (requiere Comité/Hacienda)</SelectItem>
                    <SelectItem value="ACUERDO_MARCO_ASIGNACION" className="text-white">VI — Asignación sobre acuerdo marco</SelectItem>
                    <SelectItem value="TIENDA_DIGITAL_ORDEN" className="text-white">VII — Orden tienda digital</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-slate-300">Tipo Contratacion *</Label>
                <Select value={form.tipoContratacion} onValueChange={(v) => setForm({ ...form, tipoContratacion: v as any })}>
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-700 border-slate-600">
                    <SelectItem value="OBRA" className="text-white">Obra</SelectItem>
                    <SelectItem value="SERVICIO" className="text-white">Servicio</SelectItem>
                    <SelectItem value="BIENES" className="text-white">Bienes</SelectItem>
                    <SelectItem value="CONCESION" className="text-white">Concesion</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-slate-300">Monto Presupuestado *</Label>
                <Input
                  required type="number" value={form.montoPresupuestado}
                  onChange={(e) => setForm({ ...form, montoPresupuestado: e.target.value })}
                  className="bg-slate-700 border-slate-600 text-white"
                  placeholder="0.00"
                />
              </div>

              <div>
                <Label className="text-slate-300">Moneda</Label>
                <Select value={form.moneda} onValueChange={(v) => setForm({ ...form, moneda: v as any })}>
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-700 border-slate-600">
                    <SelectItem value="MXN" className="text-white">MXN</SelectItem>
                                      </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-slate-300">Fecha Publicacion</Label>
                <Input
                  type="date" value={form.fechaPublicacion}
                  onChange={(e) => setForm({ ...form, fechaPublicacion: e.target.value })}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>

              <div>
                <Label className="text-slate-300">Fecha Cierre</Label>
                <Input
                  type="date" value={form.fechaCierre}
                  onChange={(e) => setForm({ ...form, fechaCierre: e.target.value })}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><Label className="text-slate-300">Fecha Apertura</Label><Input type="date" value={form.fechaApertura} onChange={(e)=>setForm({...form,fechaApertura:e.target.value})} className="bg-slate-700 border-slate-600 text-white"/></div>
              <div><Label className="text-slate-300">Modo de evaluación</Label><Select value={form.modoEvaluacion} onValueChange={(v)=>setForm({...form,modoEvaluacion:v as any})}><SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue/></SelectTrigger><SelectContent className="bg-slate-700 border-slate-600"><SelectItem value="HIBRIDA">Híbrida</SelectItem><SelectItem value="MANUAL">Manual</SelectItem><SelectItem value="AUTOMATICA">Automática</SelectItem></SelectContent></Select></div>
              <div><Label className="text-slate-300">Ponderación técnica</Label><Input type="number" min="0" max="100" step="0.01" value={form.ponderacionTecnica} onChange={(e)=>setForm({...form,ponderacionTecnica:e.target.value})} className="bg-slate-700 border-slate-600 text-white"/></div>
              <div><Label className="text-slate-300">Ponderación económica</Label><Input type="number" min="0" max="100" step="0.01" value={form.ponderacionEconomica} onChange={(e)=>setForm({...form,ponderacionEconomica:e.target.value})} className="bg-slate-700 border-slate-600 text-white"/></div>
              <div className="sm:col-span-2"><Label className="text-slate-300">Rúbrica técnica (JSON opcional, pesos suman 100)</Label><Textarea value={form.rubricaTecnica} onChange={(e)=>setForm({...form,rubricaTecnica:e.target.value})} placeholder='[{"codigo":"experiencia","peso":50},{"codigo":"metodologia","peso":50}]' className="bg-slate-700 border-slate-600 text-white"/></div>
            </div>

            <div className="pt-4 flex gap-3">
              <Button
                type="submit"
                className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700"
                disabled={createMutation.isPending}
              >
                <Plus className="w-4 h-4 mr-2" />
                {createMutation.isPending ? "Creando..." : "Crear Licitacion"}
              </Button>
              <Link to="/licitaciones">
                <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700">Cancelar</Button>
              </Link>
            </div>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
