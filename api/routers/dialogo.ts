import { z } from "zod";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, procedureMutation, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { dialogoRondas } from "@db/schema";
import { assertLicitacionExists } from "../lib/domain";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import { licitacionIdFromInput, licitacionIdFromDialogoRonda } from "../lib/procedure-resolvers";
import {
  assertTransitionAllowed,
  mergeModalidadRequisitos,
  normalizeModalidad,
} from "../lib/procedure-policy";
import { assertCalendarioPermite } from "../lib/calendario-gates";
import { writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";

const DIALOGO_MODALIDADES = new Set(["DIALOGO_COMPETITIVO"]);
const NOTA_MODALIDADES = new Set(["DIALOGO_COMPETITIVO", "ADJUDICACION_DIRECTA_NEGOCIACION"]);

function assertModalidadForDialogo(tipo: string, forNota = false) {
  const m = normalizeModalidad(tipo as any);
  const ok = forNota ? NOTA_MODALIDADES.has(m) : DIALOGO_MODALIDADES.has(m);
  if (!ok) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: forNota
        ? `registrarNota sólo aplica a DIALOGO_COMPETITIVO o ADJUDICACION_DIRECTA_NEGOCIACION (actual: ${tipo}).`
        : `Rondas de diálogo sólo aplican a DIALOGO_COMPETITIVO (actual: ${tipo}).`,
    });
  }
  return m;
}

export const dialogoRouter = createRouter({
  listRondas: authedQuery
    .input(
      z
        .object({
          licitacionId: z.number().int().positive().optional(),
          page: z.number().int().positive().optional(),
          pageSize: z.number().int().positive().max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
      const conditions = [eq(dialogoRondas.tenantId, ctx.user.tenantId)];
      if (input?.licitacionId) conditions.push(eq(dialogoRondas.licitacionId, input.licitacionId));
      const where = and(...conditions);
      const db = getDb();
      const [items, totalRows] = await Promise.all([
        db.query.dialogoRondas.findMany({
          where,
          orderBy: [desc(dialogoRondas.ronda), desc(dialogoRondas.createdAt)],
          limit: pageSize,
          offset,
        }),
        db.select({ total: count() }).from(dialogoRondas).where(where),
      ]);
      return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
    }),

  getRonda: authedQuery.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const row = await getDb().query.dialogoRondas.findFirst({
      where: and(eq(dialogoRondas.id, input.id), eq(dialogoRondas.tenantId, ctx.user.tenantId)),
    });
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Ronda de diálogo no encontrada." });
    return row;
  }),

  abrirRonda: procedureMutation({
    capability: "publicar",
    role: "creador",
    resolveLicitacionId: (i) => licitacionIdFromInput(i),
  })
    .input(
      z.object({
        licitacionId: z.number().int().positive(),
        tema: z.string().trim().min(3).max(240),
        participantes: z.array(z.union([z.string(), z.number()])).max(50).optional(),
        documentoId: z.number().int().positive().optional(),
        motivo: z.string().trim().min(3),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const lic = await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
      const modalidad = assertModalidadForDialogo(lic.tipoLicitacion);
      const requisitos = mergeModalidadRequisitos(null, (lic as any).modalidadMeta);
      assertTransitionAllowed(modalidad, "DIALOGO_RONDA_ABRIR", requisitos);
      await assertCalendarioPermite(ctx.user.tenantId, input.licitacionId, "DIALOGO_RONDA");
      const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
      if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin expediente electrónico." });

      const db = getDb();
      let rondaId = 0;
      await db.transaction(async (tx) => {
        const open = await tx.query.dialogoRondas.findFirst({
          where: and(
            eq(dialogoRondas.tenantId, ctx.user.tenantId),
            eq(dialogoRondas.licitacionId, input.licitacionId),
            eq(dialogoRondas.estado, "ABIERTA"),
          ),
        });
        if (open) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Ya hay una ronda ABIERTA (#${open.ronda}). Ciérrela antes de abrir otra.`,
          });
        }
        const maxRows = await tx
          .select({ maxRonda: sql<number>`COALESCE(MAX(${dialogoRondas.ronda}), 0)` })
          .from(dialogoRondas)
          .where(
            and(eq(dialogoRondas.tenantId, ctx.user.tenantId), eq(dialogoRondas.licitacionId, input.licitacionId)),
          );
        const nextRonda = Number(maxRows[0]?.maxRonda ?? 0) + 1;
        const result = await tx.insert(dialogoRondas).values({
          tenantId: ctx.user.tenantId,
          licitacionId: input.licitacionId,
          expedienteId: expediente.id,
          ronda: nextRonda,
          tema: input.tema,
          participantes: input.participantes ?? [],
          documentoId: input.documentoId ?? null,
          estado: "ABIERTA",
          createdBy: ctx.user.id,
          motivoApertura: input.motivo,
        });
        rondaId = Number(result[0].insertId);
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: expediente.id,
          tipo: "DIALOGO_RONDA_ABIERTA",
          estadoAnterior: null,
          estadoNuevo: "ABIERTA",
          motivo: input.motivo,
          payload: { rondaId, ronda: nextRonda, licitacionId: input.licitacionId, tema: input.tema },
        });
      });
      const created = await db.query.dialogoRondas.findFirst({
        where: and(eq(dialogoRondas.id, rondaId), eq(dialogoRondas.tenantId, ctx.user.tenantId)),
      });
      await writeAudit({
        ctx: ctxForAudit(ctx),
        accion: "CREAR",
        entidad: "dialogo_rondas",
        entidadId: rondaId,
        valorNuevo: created,
        motivo: input.motivo,
      });
      return created;
    }),

  cerrarRonda: procedureMutation({
    capability: "publicar",
    role: "creador",
    resolveLicitacionId: (i, ctx) => licitacionIdFromDialogoRonda(i, ctx.user!.tenantId),
  })
    .input(
      z.object({
        id: z.number().int().positive(),
        motivo: z.string().trim().min(3),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const current = await db.query.dialogoRondas.findFirst({
        where: and(eq(dialogoRondas.id, input.id), eq(dialogoRondas.tenantId, ctx.user.tenantId)),
      });
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Ronda no encontrada." });
      if (current.estado !== "ABIERTA") {
        throw new TRPCError({ code: "CONFLICT", message: "Sólo una ronda ABIERTA puede cerrarse." });
      }
      const lic = await assertLicitacionExists(ctx.user.tenantId, current.licitacionId);
      const modalidad = assertModalidadForDialogo(lic.tipoLicitacion);
      const requisitos = mergeModalidadRequisitos(null, (lic as any).modalidadMeta);
      assertTransitionAllowed(modalidad, "DIALOGO_RONDA_CERRAR", requisitos);
      await assertCalendarioPermite(ctx.user.tenantId, current.licitacionId, "DIALOGO_RONDA");

      await db.transaction(async (tx) => {
        const result = await tx
          .update(dialogoRondas)
          .set({
            estado: "CERRADA",
            cerradaBy: ctx.user.id,
            cerradaAt: new Date(),
            motivoCierre: input.motivo,
          })
          .where(
            and(
              eq(dialogoRondas.id, input.id),
              eq(dialogoRondas.tenantId, ctx.user.tenantId),
              eq(dialogoRondas.estado, "ABIERTA"),
            ),
          );
        if (Number(result[0]?.affectedRows ?? 0) !== 1) {
          throw new TRPCError({ code: "CONFLICT", message: "La ronda cambió de estado." });
        }
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: current.expedienteId,
          tipo: "DIALOGO_RONDA_CERRADA",
          estadoAnterior: "ABIERTA",
          estadoNuevo: "CERRADA",
          motivo: input.motivo,
          payload: { rondaId: current.id, ronda: current.ronda },
        });
      });
      const updated = await db.query.dialogoRondas.findFirst({
        where: and(eq(dialogoRondas.id, input.id), eq(dialogoRondas.tenantId, ctx.user.tenantId)),
      });
      await writeAudit({
        ctx: ctxForAudit(ctx),
        accion: "TRANSICION",
        entidad: "dialogo_rondas",
        entidadId: input.id,
        valorAnterior: current,
        valorNuevo: updated,
        motivo: input.motivo,
      });
      return updated;
    }),

  registrarNota: procedureMutation({
    capability: "publicar",
    role: "creador",
    resolveLicitacionId: (i, ctx) => licitacionIdFromDialogoRonda(i, ctx.user!.tenantId),
  })
    .input(
      z.object({
        id: z.number().int().positive(),
        nota: z.string().trim().min(5).max(8000),
        motivo: z.string().trim().min(3),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const current = await db.query.dialogoRondas.findFirst({
        where: and(eq(dialogoRondas.id, input.id), eq(dialogoRondas.tenantId, ctx.user.tenantId)),
      });
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Ronda no encontrada." });
      if (current.estado !== "ABIERTA") {
        throw new TRPCError({ code: "CONFLICT", message: "Sólo se registran notas en rondas ABIERTAS." });
      }
      const lic = await assertLicitacionExists(ctx.user.tenantId, current.licitacionId);
      const modalidad = assertModalidadForDialogo(lic.tipoLicitacion, true);
      const requisitos = mergeModalidadRequisitos(null, (lic as any).modalidadMeta);
      assertTransitionAllowed(modalidad, "DIALOGO_NOTA", requisitos);

      const stamp = new Date().toISOString();
      const prev = (current.notas ?? "").trim();
      const appended = prev
        ? `${prev}\n\n---\n[${stamp}] ${input.nota}`
        : `[${stamp}] ${input.nota}`;

      await db.transaction(async (tx) => {
        await tx
          .update(dialogoRondas)
          .set({ notas: appended })
          .where(and(eq(dialogoRondas.id, input.id), eq(dialogoRondas.tenantId, ctx.user.tenantId)));
        await appendExpedienteEvent(tx, ctx, {
          expedienteId: current.expedienteId,
          tipo: "DIALOGO_NOTA",
          estadoAnterior: current.estado,
          estadoNuevo: current.estado,
          motivo: input.motivo,
          payload: { rondaId: current.id, notaLen: input.nota.length },
        });
      });
      const updated = await db.query.dialogoRondas.findFirst({
        where: and(eq(dialogoRondas.id, input.id), eq(dialogoRondas.tenantId, ctx.user.tenantId)),
      });
      await writeAudit({
        ctx: ctxForAudit(ctx),
        accion: "ACTUALIZAR",
        entidad: "dialogo_rondas",
        entidadId: input.id,
        valorAnterior: { notas: current.notas },
        valorNuevo: { notas: updated?.notas },
        motivo: input.motivo,
      });
      return updated;
    }),
});
