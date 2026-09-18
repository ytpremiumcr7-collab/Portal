import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { userCapabilities, type Capability, CAPABILITIES } from "@db/schema";
// Catalog includes: crear_procedimiento, administrar_sancion, aprobar_pago, resolver_incidencia, auditar, …
import type { TrpcContext } from "../context";

export { CAPABILITIES, type Capability };

/** Default capability grants by coarse role. Admin always has all. */
export const ROLE_CAPABILITIES: Record<"admin" | "licitante" | "proveedor", Capability[]> = {
  admin: [...CAPABILITIES],
  licitante: [
    "crear_procedimiento", "publicar", "evaluar_tecnico", "evaluar_economico",
    "aprobar_juridico", "emitir_dictamen", "autorizar_fallo", "formalizar_contrato",
    "aprobar_pago", "resolver_incidencia", "administrar_planeacion", "investigar_mercado",
    "administrar_ejecucion", "resolver_inconformidad", "notificar",
  ],
  proveedor: ["notificar"],
};

export async function resolveCapabilities(user: NonNullable<TrpcContext["user"]>): Promise<Set<Capability>> {
  const base = new Set<Capability>(ROLE_CAPABILITIES[user.role] ?? []);
  if (user.role === "admin") return base;
  const overrides = await getDb().query.userCapabilities.findMany({
    where: and(eq(userCapabilities.tenantId, user.tenantId), eq(userCapabilities.userId, user.id)),
  });
  for (const row of overrides) {
    const cap = row.capability as Capability;
    if (!CAPABILITIES.includes(cap)) continue;
    if (row.granted) base.add(cap);
    else base.delete(cap);
  }
  return base;
}

export async function assertCapability(user: NonNullable<TrpcContext["user"]>, ...required: Capability[]) {
  const caps = await resolveCapabilities(user);
  for (const r of required) {
    if (!caps.has(r)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Se requiere la capacidad «${r}». Segregación de funciones: rol ${user.role} insuficiente.`,
      });
    }
  }
  return caps;
}

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}
