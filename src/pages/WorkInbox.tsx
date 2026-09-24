import { useMemo, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import PageHeader from "@/components/ares/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ares/StatusBadge";

function dueLabel(value: Date | string | null) {
  if (!value) return "Sin vencimiento";
  const d = new Date(value);
  const delta = d.getTime() - Date.now();
  const hours = Math.ceil(delta / 3_600_000);
  if (hours < 0) return `Vencida hace ${Math.abs(hours)} h`;
  if (hours <= 24) return `Vence en ${hours} h`;
  return d.toLocaleString("es-MX");
}

export default function WorkInbox() {
  const utils = trpc.useUtils();
  const inbox = trpc.work.inbox.useQuery();
  const [motivos, setMotivos] = useState<Record<number, string>>({});
  const refresh = () => utils.work.inbox.invalidate();

  const claim = trpc.work.claim.useMutation({ onSuccess: refresh });
  const complete = trpc.work.complete.useMutation({ onSuccess: refresh });
  const submit = trpc.work.submit.useMutation({ onSuccess: refresh });
  const decide = trpc.work.decide.useMutation({ onSuccess: refresh });

  const tasks = useMemo(() => inbox.data ?? [], [inbox.data]);
  const open = tasks.filter((t: any) => !["APROBADA", "RECHAZADA", "CANCELADA"].includes(t.state));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mi trabajo"
        description="Tareas institucionales asignadas por unidad, autoridad y secuencia del procedimiento."
        breadcrumbs={[{ label: "Área dependencia" }, { label: "Mi trabajo" }]}
      />

      <div className="ares-panel overflow-hidden">
        {inbox.isLoading ? (
          <p className="p-6 text-sm text-slate-500">Cargando tareas…</p>
        ) : open.length === 0 ? (
          <div className="ares-empty">
            <p className="ares-empty-title">No tiene trabajo pendiente</p>
            <p className="mt-1 text-sm text-slate-500">Las tareas aparecerán cuando su unidad tenga actos por ejecutar o aprobar.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {open.map((task: any) => {
              const motivo = motivos[task.id] ?? "";
              const busy = claim.isPending || complete.isPending || submit.isPending || decide.isPending;
              return (
                <section key={task.id} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={task.state} />
                        <span className="font-mono text-[11px] text-slate-500">{task.actionCode}</span>
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                          {task.requiredRole}
                        </span>
                      </div>
                      <h3 className="mt-2 text-base font-semibold text-slate-900">{task.title}</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Procedimiento #{task.licitacionId} · secuencia {task.sequence} · {dueLabel(task.dueAt)}
                      </p>
                    </div>
                    <Link className="text-xs font-medium underline" to={`/licitaciones/${task.licitacionId}`}>
                      Ver procedimiento
                    </Link>
                  </div>

                  {["EN_PROGRESO", "EN_REVISION"].includes(task.state) && (
                    <div className="mt-4 max-w-xl">
                      <Input
                        value={motivo}
                        onChange={(e) => setMotivos((p) => ({ ...p, [task.id]: e.target.value }))}
                        placeholder="Fundamento / motivo del acto"
                      />
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {["PENDIENTE", "DEVUELTA"].includes(task.state) && (
                      <Button size="sm" disabled={busy} onClick={() => claim.mutate({ id: task.id })}>
                        Tomar tarea
                      </Button>
                    )}
                    {task.state === "EN_PROGRESO" && task.assignedUserId != null && (
                      <>
                        <Button
                          size="sm"
                          disabled={busy || motivo.trim().length < 3}
                          onClick={() => complete.mutate({ id: task.id, motivo })}
                        >
                          Completar acto
                        </Button>
                        {task.completionMode === "REVIEW" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || motivo.trim().length < 3}
                            onClick={() => submit.mutate({ id: task.id, motivo })}
                          >
                            Enviar a revisión
                          </Button>
                        )}
                      </>
                    )}
                    {task.state === "EN_REVISION" && (
                      <>
                        <Button
                          size="sm"
                          disabled={busy || motivo.trim().length < 3}
                          onClick={() => decide.mutate({ id: task.id, decision: "APPROVE", motivo })}
                        >
                          Aprobar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || motivo.trim().length < 3}
                          onClick={() => decide.mutate({ id: task.id, decision: "RETURN", motivo })}
                        >
                          Devolver
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busy || motivo.trim().length < 3}
                          onClick={() => decide.mutate({ id: task.id, decision: "REJECT", motivo })}
                        >
                          Rechazar
                        </Button>
                      </>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {(claim.error || complete.error || submit.error || decide.error) && (
        <p className="text-sm text-red-700">
          {(claim.error || complete.error || submit.error || decide.error)?.message}
        </p>
      )}
    </div>
  );
}
