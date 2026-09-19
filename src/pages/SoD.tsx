import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ares/PageHeader";
import { StatusBadge } from "@/components/ares/StatusBadge";
import { EmptyState } from "@/components/ares/EmptyState";
import { SplitSquareVertical } from "lucide-react";

export default function SoD() {
  const [lic, setLic] = useState("");
  const [userId, setUserId] = useState("");
  const [rol, setRol] = useState("evaluador_tecnico");
  const [override, setOverride] = useState(false);
  const [just, setJust] = useState("");
  const catalog = trpc.sod.rolesCatalog.useQuery();
  const incomp = trpc.sod.listIncompatibilidades.useQuery();
  const asig = trpc.sod.listAsignaciones.useQuery(
    { licitacionId: Number(lic) || 0 },
    { enabled: !!Number(lic) },
  );
  const asignar = trpc.sod.asignar.useMutation({ onSuccess: () => asig.refetch() });
  const revocar = trpc.sod.revocar.useMutation({ onSuccess: () => asig.refetch() });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Segregación de funciones (SoD)"
        description="Asignación de roles por procedimiento e incompatibilidades. El override administrativo requiere justificación en expediente."
        breadcrumbs={[
          { label: "Sistema", href: "/usuarios" },
          { label: "SoD" },
        ]}
      />

      <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
        <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
          <CardTitle className="text-sm font-semibold text-slate-100">Incompatibilidades</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-4 text-sm text-slate-300 sm:px-5">
          {(incomp.data?.capabilities ?? []).map((r: any) => (
            <div key={r.id} className="rounded border border-slate-800 bg-slate-950/40 px-3 py-2">
              <span className="font-mono text-xs text-amber-500/90">{r.capabilityA}</span>
              <span className="mx-2 text-slate-600">↔</span>
              <span className="font-mono text-xs text-amber-500/90">{r.capabilityB}</span>
              <p className="mt-1 text-xs text-slate-500">{r.motivo}</p>
            </div>
          ))}
          {(incomp.data?.roles ?? []).map((r: any, i: number) => (
            <div key={i} className="text-xs text-slate-500">
              rol {r.a} ↔ {r.b}
            </div>
          ))}
          {!incomp.data?.capabilities?.length && !incomp.data?.roles?.length && (
            <p className="text-xs text-slate-500">Sin reglas de incompatibilidad cargadas.</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
        <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
          <CardTitle className="text-sm font-semibold text-slate-100">
            Asignar rol a procedimiento
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:px-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="ares-label ares-required">Licitación (ID)</Label>
              <Input value={lic} onChange={(e) => setLic(e.target.value)} className="ares-input max-w-[8rem]" />
            </div>
            <div className="space-y-1.5">
              <Label className="ares-label ares-required">Usuario (ID)</Label>
              <Input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="ares-input max-w-[8rem]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="ares-label ares-required">Rol</Label>
              <Input value={rol} onChange={(e) => setRol(e.target.value)} className="ares-input max-w-xs" />
            </div>
            <label className="flex items-center gap-2 pb-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
                className="rounded border-slate-600"
              />
              Override SoD
            </label>
            {override && (
              <div className="min-w-[14rem] flex-1 space-y-1.5">
                <Label className="ares-label ares-required">Justificación del override</Label>
                <Input
                  value={just}
                  onChange={(e) => setJust(e.target.value)}
                  placeholder="Mínimo 10 caracteres"
                  className="ares-input"
                />
              </div>
            )}
            <Button
              className="ares-cta"
              disabled={!lic || !userId || !rol || asignar.isPending || (override && just.length < 10)}
              onClick={() => {
                if (
                  override &&
                  !window.confirm(
                    "Está a punto de anular una incompatibilidad SoD. ¿Confirma con la justificación indicada?",
                  )
                ) {
                  return;
                }
                asignar.mutate({
                  licitacionId: Number(lic),
                  userId: Number(userId),
                  rol,
                  overrideSod: override,
                  justificacionOverride: override ? just : undefined,
                  motivo: "Asignación de rol de procedimiento",
                });
              }}
            >
              Asignar
            </Button>
          </div>
          <p className="text-[11px] text-slate-500">
            Roles disponibles: {(catalog.data?.roles ?? []).join(", ") || "—"}
          </p>
        </CardContent>
      </Card>

      <Card className="border-slate-700/80 bg-slate-900/70 shadow-none">
        <CardHeader className="border-b border-slate-800 px-4 py-3 sm:px-5">
          <CardTitle className="text-sm font-semibold text-slate-100">
            Asignaciones del procedimiento
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!Number(lic) ? (
            <EmptyState
              title="Indique el ID de licitación"
              description="Capture el identificador del procedimiento para consultar y gestionar sus asignaciones SoD."
              icon={<SplitSquareVertical className="h-5 w-5" />}
            />
          ) : !(asig.data ?? []).length ? (
            <EmptyState
              title="Sin asignaciones"
              description="Este procedimiento aún no tiene roles de segregación asignados."
              icon={<SplitSquareVertical className="h-5 w-5" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="ares-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Override</th>
                    <th className="text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {(asig.data ?? []).map((row: any) => (
                    <tr key={row.id}>
                      <td className="tabular-nums text-slate-400">{row.id}</td>
                      <td className="tabular-nums text-slate-200">{row.userId}</td>
                      <td className="font-mono text-xs text-slate-300">{row.rol}</td>
                      <td>
                        {row.overrideSod ? (
                          <StatusBadge label="Override" tone="warning" />
                        ) : (
                          <StatusBadge label="Normal" tone="neutral" />
                        )}
                      </td>
                      <td className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-red-900/50 text-xs text-red-300"
                          onClick={() => {
                            if (!window.confirm("¿Confirma revocar esta asignación SoD?")) return;
                            revocar.mutate({ id: row.id, motivo: "Revocación de asignación SoD" });
                          }}
                        >
                          Revocar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
