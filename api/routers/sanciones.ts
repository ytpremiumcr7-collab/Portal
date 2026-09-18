import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, capabilityQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { sanciones, proveedoresImpedidos, investigacionesSancion, proveedores } from "@db/schema";
import { assertSancionTransition, assertInvestigacionSancionTransition } from "../lib/phase3-transitions";
import { syncImpedimentosActivo } from "../lib/sanciones-gate";
import { writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";
import { tryNotifyEvent } from "../lib/notify-hook";

const dateMx = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");
const money = z.string().regex(/^\d+(\.\d{1,2})?$/).optional();

export const sancionesRouter = createRouter({
  list: authedQuery.input(z.object({ proveedorId: z.number().int().positive().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(sanciones.tenantId, ctx.user.tenantId)];
    if (input?.proveedorId) conditions.push(eq(sanciones.proveedorId, input.proveedorId));
    const where = and(...conditions);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.sanciones.findMany({ where, orderBy: [desc(sanciones.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(sanciones).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  listInvestigaciones: authedQuery.input(z.object({ page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const where = eq(investigacionesSancion.tenantId, ctx.user.tenantId);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.investigacionesSancion.findMany({ where, orderBy: [desc(investigacionesSancion.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(investigacionesSancion).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  listImpedidos: authedQuery.input(z.object({ activos: z.boolean().optional() }).optional()).query(async ({ input, ctx }) => {
    await syncImpedimentosActivo(ctx.user.tenantId);
    const conditions = [eq(proveedoresImpedidos.tenantId, ctx.user.tenantId)];
    if (input?.activos !== false) conditions.push(eq(proveedoresImpedidos.activo, true));
    return getDb().query.proveedoresImpedidos.findMany({ where: and(...conditions), orderBy: [desc(proveedoresImpedidos.createdAt)] });
  }),

  syncImpedimentos: capabilityQuery("administrar_sancion").mutation(async ({ ctx }) => {
    return syncImpedimentosActivo(ctx.user.tenantId);
  }),

  abrirInvestigacion: capabilityQuery("investigar_sancion").input(z.object({
    proveedorId: z.number().int().positive(), folio: z.string().trim().min(3).max(60),
    resumen: z.string().trim().min(10), alertaId: z.number().int().positive().optional(),
    incidenciaId: z.number().int().positive().optional(), motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const prov = await db.query.proveedores.findFirst({ where: and(eq(proveedores.id, input.proveedorId), eq(proveedores.tenantId, ctx.user.tenantId)) });
    if (!prov) throw new TRPCError({ code: "NOT_FOUND", message: "Proveedor no encontrado." });
    const result = await db.insert(investigacionesSancion).values({
      tenantId: ctx.user.tenantId, proveedorId: input.proveedorId, folio: input.folio, resumen: input.resumen,
      estado: "ABIERTA", abiertaPor: ctx.user.id, alertaId: input.alertaId ?? null, incidenciaId: input.incidenciaId ?? null,
    });
    const id = Number(result[0].insertId);
    const created = await db.query.investigacionesSancion.findFirst({ where: and(eq(investigacionesSancion.id, id), eq(investigacionesSancion.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "investigaciones_sancion", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  /** ABIERTA → EN_TRAMITE → CERRADA_SIN_SANCION | (escalate via crear sanción → DERIVADA_SANCION). */
  transicionarInvestigacion: capabilityQuery("investigar_sancion").input(z.object({
    id: z.number().int().positive(),
    to: z.enum(["EN_TRAMITE", "CERRADA_SIN_SANCION"]),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await db.query.investigacionesSancion.findFirst({ where: and(eq(investigacionesSancion.id, input.id), eq(investigacionesSancion.tenantId, ctx.user.tenantId)) });
    if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Investigación no encontrada." });
    assertInvestigacionSancionTransition(cur.estado as any, input.to);
    const patch: Record<string, unknown> = { estado: input.to };
    if (input.to === "CERRADA_SIN_SANCION") patch.cerradaAt = new Date();
    await db.update(investigacionesSancion).set(patch as any)
      .where(and(eq(investigacionesSancion.id, input.id), eq(investigacionesSancion.tenantId, ctx.user.tenantId), eq(investigacionesSancion.estado, cur.estado)));
    const updated = await db.query.investigacionesSancion.findFirst({ where: and(eq(investigacionesSancion.id, input.id), eq(investigacionesSancion.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "TRANSICION", entidad: "investigaciones_sancion", entidadId: input.id, valorAnterior: cur, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),

  crear: capabilityQuery("administrar_sancion").input(z.object({
    proveedorId: z.number().int().positive(),
    investigacionId: z.number().int().positive().optional(),
    fromAlertaId: z.number().int().positive().optional(),
    tipo: z.enum(["AMONESTACION", "MULTA", "INHABILITACION", "RESCISION", "IMPEDIMENTO"]),
    fundamento: z.string().trim().min(10), autoridad: z.string().trim().min(3).max(200),
    resolucion: z.string().trim().min(10), folio: z.string().trim().min(3).max(80),
    vigenciaInicio: dateMx.optional(), vigenciaFin: dateMx.optional(),
    montoMulta: money, impedimentoParticipacion: z.boolean().default(false),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    let investigacionId = input.investigacionId ?? null;
    // From alerta: must link investigation — no inventing autoridad/sanción free-only.
    if (input.fromAlertaId && !investigacionId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Una sanción derivada de alerta requiere investigación vinculada (investigacionId). No se inventa autoridad sin expediente de investigación.",
      });
    }
    if (investigacionId) {
      const inv = await db.query.investigacionesSancion.findFirst({
        where: and(eq(investigacionesSancion.id, investigacionId), eq(investigacionesSancion.tenantId, ctx.user.tenantId)),
      });
      if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Investigación no encontrada." });
      if (!["ABIERTA", "EN_TRAMITE"].includes(inv.estado)) {
        throw new TRPCError({ code: "CONFLICT", message: `Investigación en estado ${inv.estado}; no admite derivar sanción.` });
      }
      if (Number(inv.proveedorId) !== Number(input.proveedorId)) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La investigación no corresponde al proveedor." });
      }
    }
    const result = await db.insert(sanciones).values({
      tenantId: ctx.user.tenantId, proveedorId: input.proveedorId, investigacionId,
      tipo: input.tipo, fundamento: input.fundamento, autoridad: input.autoridad, resolucion: input.resolucion,
      folio: input.folio, estado: "BORRADOR", vigenciaInicio: input.vigenciaInicio ?? null, vigenciaFin: input.vigenciaFin ?? null,
      montoMulta: input.montoMulta ?? null, impedimentoParticipacion: input.impedimentoParticipacion,
    } as any);
    const id = Number(result[0].insertId);
    const created = await db.query.sanciones.findFirst({ where: and(eq(sanciones.id, id), eq(sanciones.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "sanciones", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  transicionar: capabilityQuery("administrar_sancion").input(z.object({
    id: z.number().int().positive(),
    to: z.enum(["EMITIDA", "VIGENTE", "CUMPLIDA", "REVOCADA"]),
    motivo: z.string().trim().min(3),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const cur = await db.query.sanciones.findFirst({ where: and(eq(sanciones.id, input.id), eq(sanciones.tenantId, ctx.user.tenantId)) });
    if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Sanción no encontrada." });
    assertSancionTransition(cur.estado as any, input.to);
    const patch: Record<string, unknown> = { estado: input.to };
    if (input.to === "EMITIDA") { patch.emitidaPor = ctx.user.id; patch.emitidaAt = new Date(); }
    await db.transaction(async (tx) => {
      await tx.update(sanciones).set(patch as any).where(and(eq(sanciones.id, input.id), eq(sanciones.tenantId, ctx.user.tenantId), eq(sanciones.estado, cur.estado)));
      if (input.to === "VIGENTE" && cur.impedimentoParticipacion) {
        await tx.insert(proveedoresImpedidos).values({
          tenantId: ctx.user.tenantId, proveedorId: cur.proveedorId, sancionId: cur.id,
          motivo: cur.resolucion, vigenteDesde: (cur.vigenciaInicio ?? new Date().toISOString().slice(0, 10)) as any,
          vigenteHasta: (cur.vigenciaFin ?? null) as any, activo: true,
        } as any);
      }
      if (input.to === "CUMPLIDA" || input.to === "REVOCADA") {
        await tx.update(proveedoresImpedidos).set({ activo: false }).where(and(
          eq(proveedoresImpedidos.tenantId, ctx.user.tenantId), eq(proveedoresImpedidos.sancionId, cur.id),
        ));
      }
      if (cur.investigacionId && input.to === "EMITIDA") {
        await tx.update(investigacionesSancion).set({ estado: "DERIVADA_SANCION", cerradaAt: new Date() })
          .where(and(eq(investigacionesSancion.id, cur.investigacionId), eq(investigacionesSancion.tenantId, ctx.user.tenantId)));
      }
    });
    const updated = await db.query.sanciones.findFirst({ where: and(eq(sanciones.id, input.id), eq(sanciones.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "TRANSICION", entidad: "sanciones", entidadId: input.id, valorAnterior: cur, valorNuevo: updated, motivo: input.motivo });
    if (input.to === "EMITIDA") {
      await tryNotifyEvent({
        tenantId: ctx.user.tenantId, actorUserId: ctx.user.id, codigoEvento: "SANCION_EMITIDA",
        asunto: `Sanción emitida ${cur.folio}`, cuerpo: cur.resolucion,
        entidadRef: "sanciones", entidadId: cur.id, proveedorId: cur.proveedorId,
      });
    }
    await syncImpedimentosActivo(ctx.user.tenantId);
    return updated;
  }),
});
