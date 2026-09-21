import { useParams, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";
import { EmptyState } from "@/components/ares/EmptyState";
import { FileText, Building2, Users, Trophy, ShieldCheck, Gavel } from "lucide-react";

export default function LicitacionDetalle() {
  const { id } = useParams<{ id: string }>();
  const licId = parseInt(id || "0");

  const { data: lic, isLoading } = trpc.licitaciones.getById.useQuery({ id: licId });
  const im = trpc.investigacionMercado.porLicitacion.useQuery({ licitacionId: licId }, { enabled: licId > 0 });
  const utils = trpc.useUtils();
  const evaluate = trpc.participaciones.evaluar.useMutation({
    onSuccess: () => utils.licitaciones.getById.invalidate({ id: licId }),
  });
  const startEvaluation = trpc.licitaciones.iniciarEvaluacion.useMutation({
    onSuccess: () => utils.licitaciones.getById.invalidate({ id: licId }),
  });
  const detect = trpc.alertas.detectar.useMutation();
  const adjudicate = trpc.licitaciones.adjudicar.useMutation({
    onSuccess: () => utils.licitaciones.getById.invalidate({ id: licId }),
  });

  const formatCurrency = (value: string | null) => {
    if (!value) return "$0";
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(parseFloat(value));
  };

  const formatDate = (value: Date | string | null) => {
    if (!value) return "—";
    if (value instanceof Date) return value.toLocaleDateString("es-MX");
    return value;
  };

  if (isLoading) {
    return <p className="py-12 text-center text-sm text-slate-400">Cargando expediente…</p>;
  }
  if (!lic) {
    return (
      <EmptyState
        title="Licitación no encontrada"
        description="El procedimiento solicitado no existe o no tiene permisos para consultarlo."
        action={
          <Link to="/licitaciones">
            <Button variant="outline" size="sm" className="border-slate-600 text-slate-300">
              Volver al catálogo
            </Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={lic.titulo}
        description="Expediente del procedimiento de contratación. Acciones disponibles según el estado actual."
        breadcrumbs={[
          { label: "Procedimiento", href: "/licitaciones" },
          { label: "Licitaciones", href: "/licitaciones" },
          { label: lic.codigo },
        ]}
        meta={
          <>
            <span className="font-mono text-xs text-slate-400">{lic.codigo}</span>
            <StatusBadge status={lic.estado} />
          </>
        }
        actions={
          <Link to="/licitaciones">
            <Button variant="outline" size="sm" className="border-slate-600 text-slate-300">
              Volver
            </Button>
          </Link>
        }
      />

      <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
        <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
          <CardTitle className="text-sm font-semibold text-slate-100">Investigación de mercado (planeación)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-4 text-sm text-slate-300">
          {im.data?.exigeInvestigacion === false ? (
            <p>{im.data.nota}</p>
          ) : (
            <>
              <p>
                {im.data?.estudio
                  ? `Estudio #${im.data.estudio.id} · ${im.data.estudio.folio} · ${im.data.estudio.estado}`
                  : "No hay estudio vinculado a este procedimiento."}
              </p>
              {im.data?.listoParaPublicarIm ? (
                <p className="text-emerald-400 text-xs">El gate de publicación encuentra un estudio CONCLUIDO con este licitacionId.</p>
              ) : (
                <ul className="list-disc pl-5 text-xs text-amber-400">
                  {(im.data?.faltantes ?? ["Cargando estado del estudio…"]).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          <Link to="/investigacion-mercado">
            <Button size="sm" variant="outline" className="border-slate-600 text-slate-300">
              Abrir investigación de mercado
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
        <CardContent className="flex flex-wrap gap-2 p-4">
          {(lic.estado === "PUBLICADA" || lic.estado === "CONSULTAS") && (
            <Button
              onClick={() =>
                startEvaluation.mutate({
                  id: lic.id,
                  motivo: "Inicio de evaluación desde expediente",
                })
              }
              disabled={startEvaluation.isPending}
              className="bg-sky-700 hover:bg-sky-600"
            >
              <Gavel className="mr-2 h-4 w-4" />
              Iniciar evaluación
            </Button>
          )}
          {lic.estado === "EN_EVALUACION" && (
            <Button
              onClick={() =>
                detect.mutate({
                  licitacionId: lic.id,
                  motivo: "Análisis heurístico de riesgo",
                })
              }
              disabled={detect.isPending}
              variant="outline"
              className="border-red-800/60 text-red-300 hover:bg-red-950/40"
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              Analizar riesgos
            </Button>
          )}
          <Link to={`/documentos?licitacionId=${lic.id}`}>
            <Button variant="outline" className="border-slate-600 text-slate-300">
              Gestionar expediente
            </Button>
          </Link>
          <Link to={`/hitos?licitacionId=${lic.id}`}>
            <Button variant="outline" className="border-slate-600 text-slate-300">
              Gestionar hitos
            </Button>
          </Link>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
          <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <FileText className="h-4 w-4 text-slate-400" />
              Información general
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 p-4 sm:px-5">
            <div>
              <p className="text-xs text-slate-500">Entidad</p>
              <p className="mt-0.5 text-sm text-slate-100">{lic.entidad?.razonSocial}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Categoría</p>
              <p className="mt-0.5 text-sm text-slate-100">{lic.categoria?.nombre}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Tipo</p>
              <p className="mt-0.5 text-sm text-slate-100">
                {lic.tipoLicitacion?.replace(/_/g, " ")}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Contratación</p>
              <p className="mt-0.5 text-sm text-slate-100">{lic.tipoContratacion}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Monto presupuestado</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-50">
                {formatCurrency(lic.montoPresupuestado)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Moneda</p>
              <p className="mt-0.5 text-sm text-slate-100">{lic.moneda}</p>
            </div>
            {lic.fechaPublicacion && (
              <div>
                <p className="text-xs text-slate-500">Fecha de publicación</p>
                <p className="mt-0.5 text-sm text-slate-100">{formatDate(lic.fechaPublicacion)}</p>
              </div>
            )}
            {lic.fechaCierre && (
              <div>
                <p className="text-xs text-slate-500">Fecha de cierre</p>
                <p className="mt-0.5 text-sm text-slate-100">{formatDate(lic.fechaCierre)}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
          <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Building2 className="h-4 w-4 text-slate-400" />
              Objeto de la contratación
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:px-5">
            <p className="text-sm leading-relaxed text-slate-300">{lic.objeto}</p>
            {lic.descripcionDetallada && (
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{lic.descripcionDetallada}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {lic.proveedorGanador && (
        <Card className="border-slate-700/80 border-l-2 border-l-violet-600 bg-slate-900/70 shadow-none">
          <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Trophy className="h-4 w-4 text-violet-400" />
              Adjudicación
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3 sm:px-5">
            <div>
              <p className="text-xs text-slate-500">Ganador</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-50">
                {lic.proveedorGanador.razonSocial}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Monto adjudicado</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-50">
                {formatCurrency(lic.montoAdjudicado)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Fecha</p>
              <p className="mt-0.5 text-sm text-slate-100">{formatDate(lic.fechaAdjudicacion)}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
        <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Users className="h-4 w-4 text-slate-400" />
            Participaciones ({lic.participaciones?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!lic.participaciones?.length ? (
            <EmptyState
              title="Sin participaciones registradas"
              description="Las proposiciones de proveedores aparecerán aquí una vez capturadas."
              className="py-8"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="ares-table">
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th className="text-right">Oferta</th>
                    <th>Estado</th>
                    <th className="text-right">Puntaje</th>
                    <th className="text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {lic.participaciones?.map((p: any) => (
                    <tr key={p.id}>
                      <td className="font-medium text-slate-100">{p.proveedor?.razonSocial}</td>
                      <td className="text-right tabular-nums">{formatCurrency(p.montoOferta)}</td>
                      <td>
                        <StatusBadge label={p.estadoEvaluacion.replace(/_/g, " ")} />
                      </td>
                      <td className="text-right tabular-nums">{p.puntajeTotal || "—"}</td>
                      <td className="text-right">
                        {lic.estado === "EN_EVALUACION" && p.estadoEvaluacion === "PENDIENTE" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 border-slate-600 text-xs text-slate-300"
                            onClick={() => {
                              const rubric = lic.rubricaTecnica
                                ? JSON.parse(lic.rubricaTecnica)
                                : null;
                              if (rubric && lic.modoEvaluacion !== "MANUAL") {
                                const raw = window.prompt(
                                  `Capture criterios técnicos como JSON. Códigos: ${rubric
                                    .map((r: any) => r.codigo)
                                    .join(", ")}`,
                                );
                                if (raw === null) return;
                                try {
                                  const criterios = JSON.parse(raw);
                                  evaluate.mutate({
                                    id: p.id,
                                    criteriosTecnicos: criterios,
                                    estadoEvaluacion: "ADMISIBLE",
                                    motivo: "Evaluación técnica por rúbrica",
                                  });
                                } catch {
                                  window.alert("JSON de criterios inválido.");
                                }
                              } else {
                                const raw = window.prompt("Puntaje técnico 0-100");
                                const score = raw === null ? null : Number(raw);
                                if (score !== null && Number.isFinite(score)) {
                                  evaluate.mutate({
                                    id: p.id,
                                    puntajeTecnico: score,
                                    estadoEvaluacion: "ADMISIBLE",
                                    motivo: "Evaluación técnica manual",
                                  });
                                }
                              }
                            }}
                          >
                            Evaluar
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {lic.estado === "EN_EVALUACION" &&
        (() => {
          const winner = (lic.participaciones || [])
            .filter((p: any) => p.estadoEvaluacion === "ADMISIBLE")
            .sort(
              (a: any, b: any) => Number(b.puntajeTotal || 0) - Number(a.puntajeTotal || 0),
            )[0];
          return winner ? (
            <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5">
                <div>
                  <p className="text-xs text-slate-500">Primer lugar por puntaje total</p>
                  <p className="text-sm font-semibold text-slate-50">
                    {winner.proveedor?.razonSocial} · {winner.puntajeTotal}
                  </p>
                  <p className="text-xs text-slate-500">
                    Monto ofertado: {formatCurrency(winner.montoOferta)}
                  </p>
                </div>
                <Button
                  className="ares-cta"
                  onClick={() => {
                    const motivo = window.prompt("Motivo de adjudicación (obligatorio)");
                    if (!motivo) return;
                    if (
                      !window.confirm(
                        `¿Confirma adjudicar a ${winner.proveedor?.razonSocial}? Esta acción es irreversible en el flujo normal.`,
                      )
                    ) {
                      return;
                    }
                    adjudicate.mutate({
                      id: lic.id,
                      proveedorGanadorId: winner.proveedorId,
                      montoAdjudicado: String(winner.montoOferta),
                      motivo,
                    });
                  }}
                  disabled={adjudicate.isPending}
                >
                  Adjudicar
                </Button>
              </CardContent>
            </Card>
          ) : null;
        })()}
    </div>
  );
}
