import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { calendarioActos } from "@db/schema";

/**
 * When a calendar row exists for `acto`, the transition must fall inside the window.
 * Absence of calendar = no extra gate (backward compatible).
 */
export async function assertCalendarioPermite(
  tenantId: number,
  licitacionId: number,
  acto: string,
  at: Date = new Date(),
) {
  const db = getDb();
  const row = await db.query.calendarioActos.findFirst({
    where: and(
      eq(calendarioActos.tenantId, tenantId),
      eq(calendarioActos.licitacionId, licitacionId),
      eq(calendarioActos.acto, acto),
    ),
  });
  if (!row) return;
  const t = at.getTime();
  const ini = new Date(row.ventanaInicio).getTime();
  const fin = new Date(row.ventanaFin).getTime();
  if (t < ini || t > fin) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `El acto «${acto}» está fuera de la ventana jurídica del calendario (${row.ventanaInicio} – ${row.ventanaFin}).`,
    });
  }
}
