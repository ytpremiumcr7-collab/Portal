import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { calendarioActos } from "@db/schema";

/**
 * When a calendar row exists for `acto`, the transition must fall inside the window.
 * Absence of calendar = no extra gate (backward compatible) — except RECEPCION reception
 * which uses assertRecepcionDentroDeVentana (canonical ms deadline; calendar REQUIRED).
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
 * Canonical reception deadline = published calendar RECEPCION ventana_inicio/ventana_fin only (ms).
 * NEVER reunite with day-granularity fechaCierre as a second clock.
 * Domain contract = procedimiento + ProcedurePolicy snapshot + calendario.
 * deadline+1ms MUST reject. Missing RECEPCION calendar → PRECONDITION_FAILED.
 */
export async function assertRecepcionDentroDeVentana(
  tenantId: number,
  licitacionId: number,
  opts: {
    at?: Date;
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

  if (!row) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Se requiere ventana de calendario RECEPCION (ventana_inicio/ventana_fin) publicada para recibir proposiciones. No se acepta comparación por día civil (fechaCierre).",
    });
  }

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

/** Pure helper for unit tests: deadline+1ms rejects. */
export function isWithinRecepcionMs(atMs: number, ventanaFinMs: number): boolean {
  return atMs <= ventanaFinMs;
}

/** True when source is exclusively calendar (no fechaCierre day-clock). */
export function isCanonicalRecepcionSource(source: string): boolean {
  return source === "calendario";
}
