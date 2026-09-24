import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import PageHeader from "@/components/ares/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ROLES = ["OPERADOR","TECNICO","JURIDICO","PRESUPUESTO","APROBADOR","ADMIN_CONTRATO","AUDITOR"] as const;

export default function InstitutionalSetup() {
  const utils = trpc.useUtils();
  const entidades = trpc.entidades.list.useQuery({ pageSize: 100 });
  const users = trpc.auth.listUsers.useQuery({ pageSize: 100 });
  const [entidadId, setEntidadId] = useState("");
  const units = trpc.institutional.units.useQuery(
    { entidadId: Number(entidadId) || undefined },
    { enabled: true },
  );
  const [unitCode, setUnitCode] = useState("");
  const [unitName, setUnitName] = useState("");
  const [unitType, setUnitType] = useState<"UNIDAD_COMPRADORA"|"AREA_REQUIRENTE"|"JURIDICO"|"PRESUPUESTO"|"CONTRATO"|"AUDITORIA">("UNIDAD_COMPRADORA");
  const [memberUnit, setMemberUnit] = useState("");
  const [memberUser, setMemberUser] = useState("");
  const [memberRole, setMemberRole] = useState<(typeof ROLES)[number]>("OPERADOR");

  const createUnit = trpc.institutional.createUnit.useMutation({
    onSuccess: async () => {
      setUnitCode(""); setUnitName("");
      await utils.institutional.units.invalidate();
    },
  });
  const addMembership = trpc.institutional.addMembership.useMutation({
    onSuccess: async () => {
      setMemberUser("");
      await utils.institutional.memberships.invalidate();
    },
  });
  const memberships = trpc.institutional.memberships.useQuery(
    memberUnit ? { unitId: Number(memberUnit) } : undefined,
  );

  const userById = useMemo(
    () => new Map((users.data?.items ?? []).map((u: any) => [u.id, u])),
    [users.data],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Organización y autoridad"
        description="Unidades institucionales, membresías y autoridad desde la que se ejecutan actos de contratación."
        breadcrumbs={[{ label: "Administración" }, { label: "Organización y autoridad" }]}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="ares-panel p-5">
          <h3 className="text-base font-semibold">Crear unidad</h3>
          <p className="mt-1 text-xs text-slate-500">Las unidades compradoras son el límite de autoridad de los procedimientos nuevos.</p>
          <div className="mt-4 space-y-3">
            <div>
              <Label>Entidad</Label>
              <Select value={entidadId} onValueChange={(v) => { setEntidadId(v); setMemberUnit(""); }}>
                <SelectTrigger><SelectValue placeholder="Seleccione entidad" /></SelectTrigger>
                <SelectContent>
                  {entidades.data?.items.map((e: any) => <SelectItem key={e.id} value={String(e.id)}>{e.razonSocial}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Código</Label><Input value={unitCode} onChange={(e)=>setUnitCode(e.target.value.toUpperCase())} placeholder="UC-CENTRAL" /></div>
              <div><Label>Nombre</Label><Input value={unitName} onChange={(e)=>setUnitName(e.target.value)} placeholder="Unidad Compradora Central" /></div>
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={unitType} onValueChange={(v)=>setUnitType(v as typeof unitType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNIDAD_COMPRADORA">Unidad compradora</SelectItem>
                  <SelectItem value="AREA_REQUIRENTE">Área requirente</SelectItem>
                  <SelectItem value="JURIDICO">Jurídico</SelectItem>
                  <SelectItem value="PRESUPUESTO">Presupuesto</SelectItem>
                  <SelectItem value="CONTRATO">Administración contractual</SelectItem>
                  <SelectItem value="AUDITORIA">Auditoría</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={!entidadId || unitCode.trim().length < 2 || unitName.trim().length < 3 || createUnit.isPending}
              onClick={()=>createUnit.mutate({
                entidadId:Number(entidadId),code:unitCode,name:unitName,unitType,
                motivo:"Alta de unidad institucional",
              })}
            >
              Crear unidad
            </Button>
            {createUnit.error && <p className="text-sm text-red-700">{createUnit.error.message}</p>}
          </div>
        </section>

        <section className="ares-panel p-5">
          <h3 className="text-base font-semibold">Asignar membresía</h3>
          <p className="mt-1 text-xs text-slate-500">La capability global no sustituye esta autoridad institucional.</p>
          <div className="mt-4 space-y-3">
            <div>
              <Label>Unidad</Label>
              <Select value={memberUnit} onValueChange={setMemberUnit}>
                <SelectTrigger><SelectValue placeholder="Seleccione unidad" /></SelectTrigger>
                <SelectContent>
                  {(units.data ?? []).map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.code} · {u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Usuario</Label>
              <Select value={memberUser} onValueChange={setMemberUser}>
                <SelectTrigger><SelectValue placeholder="Seleccione usuario" /></SelectTrigger>
                <SelectContent>
                  {users.data?.items.map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name} · {u.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Rol institucional</Label>
              <Select value={memberRole} onValueChange={(v)=>setMemberRole(v as typeof memberRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map(r=><SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button
              disabled={!memberUnit || !memberUser || addMembership.isPending}
              onClick={()=>addMembership.mutate({
                unitId:Number(memberUnit),userId:Number(memberUser),role:memberRole,
                motivo:"Asignación de autoridad institucional",
              })}
            >
              Asignar membresía
            </Button>
            {addMembership.error && <p className="text-sm text-red-700">{addMembership.error.message}</p>}
          </div>
        </section>
      </div>

      <section className="ares-panel overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold">Membresías de la unidad</h3>
        </div>
        {!memberUnit ? (
          <p className="p-5 text-sm text-slate-500">Seleccione una unidad para inspeccionar su autoridad.</p>
        ) : !memberships.data?.length ? (
          <p className="p-5 text-sm text-slate-500">Sin membresías registradas.</p>
        ) : (
          <table className="ares-table">
            <thead><tr><th>Usuario</th><th>Rol</th><th>Vigencia</th><th>Estado</th></tr></thead>
            <tbody>
              {memberships.data.map((m: any) => {
                const u:any = userById.get(m.userId);
                return <tr key={m.id}>
                  <td><div className="font-medium">{u?.name ?? `Usuario #${m.userId}`}</div><div className="text-xs text-slate-500">{u?.email ?? ""}</div></td>
                  <td>{m.role}</td>
                  <td className="text-xs">{new Date(m.validFrom).toLocaleDateString("es-MX")} → {m.validUntil ? new Date(m.validUntil).toLocaleDateString("es-MX") : "sin término"}</td>
                  <td>{m.active ? "Activa" : "Inactiva"}</td>
                </tr>;
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
