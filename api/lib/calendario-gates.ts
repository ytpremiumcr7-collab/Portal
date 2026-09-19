import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { calendarioActos } from "@db/schema";

/**
 * When a calendar row exists for `acto`, the transition must fall inside the window.
 * Absence of calendar = no extra gate (backward compatible) — except RECEPCION reception
 * which uses assertRecepcionDentroDeVentana (canonical ms deadline).
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

/**
 * Canonical reception deadline: uses calendario RECEPCION ventana_fin timestamps (ms).
 * Published procedures SHOULD have a RECEPCION calendar row; if missing, falls back to
 * fechaCierre end-of-day (UTC) ONLY as documented last resort — prefer requiring calendar.
 *
 * deadline+1ms MUST reject.
 */
export async function assertRecepcionDentroDeVentana(
  tenantId: number,
  licitacionId: number,
  opts: {
    fechaCierre?: string | Date | null;
    at?: Date;
    /** When true (default for PUBLICADA), missing RECEPCION calendar is PRECONDITION_FAILED. */
    requireCalendar?: boolean;
  } = {},
) {
  const at = opts.at ?? new Date();
  const db = getDb();
  const row = await db.query.calendarioActos.findFirst({
    where: and(
      eq(calendarioActos.tenantId, tenantId),
      eq(calendarioActos.licitacionId, licitacionId),
      eq(calendarioActos.acto, "RECEPCION"),
    ),
  });

  if (row) {
    const t = at.getTime();
    const ini = new Date(row.ventanaInicio).getTime();
    const fin = new Date(row.ventanaFin).getTime();
    if (t < ini) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `La recepción aún no abre (ventana desde ${row.ventanaInicio}).`,
      });
    }
    // Strict: t > fin rejects (deadline+1ms REJECT). t === fin still accepted.
    if (t > fin) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `El periodo de presentación de ofertas cerró en ${row.ventanaFin} (comparación canónica ms).`,
      });
    }
    return { source: "calendario" as const, ventanaFin: fin };
  }

  const requireCalendar = opts.requireCalendar !== false;
  if (requireCalendar) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Se requiere ventana de calendario RECEPCION (ventana_inicio/ventana_fin) publicada para recibir proposiciones. No se acepta comparación por día civil.",
    });
  }

  // Documented last resort: fechaCierre as end-of-day UTC (23:59:59.999).
  if (!opts.fechaCierre) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Sin calendario RECEPCION ni fechaCierre: no se puede validar el plazo de recepción.",
    });
  }
  const ymd =
    opts.fechaCierre instanceof Date
      ? opts.fechaCierre.toISOString().slice(0, 10)
      : String(opts.fechaCierre).slice(0, 10);
  const fin = Date.parse(`${ymd}T23:59:59.999Z`);
  if (!Number.isFinite(fin)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "fechaCierre inválida." });
  }
  if (at.getTime() > fin) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `El periodo de presentación de ofertas ya cerró (fechaCierre fin-de-día ${ymd} UTC, fallback documentado).`,
    });
  }
  return { source: "fechaCierre_eod" as const, ventanaFin: fin };
}

/** Pure helper for unit tests: deadline+1ms rejects. */
export function isWithinRecepcionMs(atMs: number, ventanaFinMs: number): boolean {
  return atMs <= ventanaFinMs;
}
