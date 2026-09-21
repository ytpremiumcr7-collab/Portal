import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { procedimientoAsignaciones } from "@db/schema";
import { assertProcedimientoAsignacion, type ProcedimientoRole, type SodUser } from "./sod";
import { institutionalEnv } from "./institutional-env";

export const APERTURA_ROLES = [
  "cerrar_recepcion",
  "sellar_propuestas",
  "autorizar_apertura",
  "ejecutar_apertura",
  "certificar_acta_apertura",
  "publicar_acta_apertura",
] as const;

export type AperturaRole = (typeof APERTURA_ROLES)[number];

/** Progressive SoD: specialized roles if present; otherwise creador + CONCENTRATED_CREADOR. */
export async function assertAperturaAuthority(
  user: SodUser,
  licitacionId: number,
  specialized: AperturaRole,
): Promise<{ sodMode: "SPECIALIZED" | "CONCENTRATED_CREADOR" }> {
  const db = getDb();
  const specializedRows = await db.query.procedimientoAsignaciones.findMany({
    where: and(
      eq(procedimientoAsignaciones.tenantId, user.tenantId),
      eq(procedimientoAsignaciones.licitacionId, licitacionId),
      inArray(procedimientoAsignaciones.rol, [...APERTURA_ROLES]),
    ),
  });
  if (specializedRows.length > 0 || institutionalEnv.aperturaSodStrict) {
    await assertProcedimientoAsignacion(user, licitacionId, specialized as ProcedimientoRole);
    return { sodMode: "SPECIALIZED" };
  }
  await assertProcedimientoAsignacion(user, licitacionId, ["creador", specialized as ProcedimientoRole]);
  return { sodMode: "CONCENTRATED_CREADOR" };
}
