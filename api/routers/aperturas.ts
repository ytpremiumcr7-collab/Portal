import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, procedureMutation, authedQuery, ctxForAudit } from "../middleware";
import { licitacionIdFromApertura, licitacionIdFromInput } from "../lib/procedure-resolvers";
import { getDb } from "../queries/connection";
import { aperturas, aperturaRegistros, participaciones, licitaciones, proposiciones, proposicionDocumentos, licitacionReglasVersion, consorcioMiembros } from "@db/schema";
import { findExpedienteByLicitacion, appendExpedienteEvent } from "../lib/expediente";
import { assertLicitacionExists } from "../lib/domain";
import { assertAperturaTransition } from "../lib/phase2-transitions";
import { writeAudit } from "../lib/security";
import { pageInput, pageResult } from "../lib/pagination";
import { buildProposicionManifest, buildAperturaSealFromProposicionManifests, assertProposicionDocsCompletos, assertProposicionSelladaCompleta } from "../lib/proposicion";
import { parseRequisitos } from "../lib/procedure-policy";
import { assertCalendarioPermite } from "../lib/calendario-gates";
import { loadSobreForParticipacion, revelarSobresEconomicos } from "../lib/sobre-economico";
import { ciphertextHash } from "../lib/envelope-crypto";

export const aperturasRouter = createRouter({
  list: authedQuery.input(z.object({ licitacionId: z.number().int().positive().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(aperturas.tenantId, ctx.user.tenantId)];
    if (input?.licitacionId) conditions.push(eq(aperturas.licitacionId, input.licitacionId));
    const where = and(...conditions);
    const db = getDb();
    const [items, totalRows] = await Promise.all([
      db.query.aperturas.findMany({ where, orderBy: [desc(aperturas.createdAt)], limit: pageSize, offset }),
      db.select({ total: count() }).from(aperturas).where(where),
    ]);
    return pageResult(items, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getByLicitacion: authedQuery.input(z.object({ licitacionId: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const item = await getDb().query.aperturas.findFirst({
      where: and(eq(aperturas.tenantId, ctx.user.tenantId), eq(aperturas.licitacionId, input.licitacionId)),
      with: { registros: true },
    });
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Apertura no encontrada." });
    return item;
  }),

  iniciar: procedureMutation({ capability: "publicar", role: "creador", resolveLicitacionId: (i) => licitacionIdFromInput(i) }).input(z.object({ licitacionId: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const lic = await assertLicitacionExists(ctx.user.tenantId, input.licitacionId);
    await assertCalendarioPermite(ctx.user.tenantId, input.licitacionId, "RECEPCION");
    if (lic.estado !== "PUBLICADA") throw new TRPCError({ code: "CONFLICT", message: "La recepción sólo inicia en PUBLICADA." });
    const expediente = await findExpedienteByLicitacion(ctx.user.tenantId, input.licitacionId);
    if (!expediente) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sin expediente." });
    const db = getDb();
    let id = 0;
    await db.transaction(async (tx) => {
      const dup = await tx.query.aperturas.findFirst({ where: and(eq(aperturas.tenantId, ctx.user.tenantId), eq(aperturas.licitacionId, input.licitacionId)) });
      if (dup) throw new TRPCError({ code: "CONFLICT", message: "Ya existe un acto de apertura." });
      const result = await tx.insert(aperturas).values({
        tenantId: ctx.user.tenantId, expedienteId: expediente.id, licitacionId: input.licitacionId,
        estado: "RECEPCION_ABIERTA", creadaPor: ctx.user.id,
      });
      id = Number(result[0].insertId);
      await tx.update(licitaciones).set({ etapa: "PRESENTACION" }).where(and(eq(licitaciones.id, input.licitacionId), eq(licitaciones.tenantId, ctx.user.tenantId)));
      await appendExpedienteEvent(tx, ctx, { expedienteId: expediente.id, tipo: "APERTURA_INICIADA", estadoAnterior: null, estadoNuevo: "RECEPCION_ABIERTA", motivo: input.motivo, payload: { aperturaId: id } });
    });
    const created = await getDb().query.aperturas.findFirst({ where: and(eq(aperturas.id, id), eq(aperturas.tenantId, ctx.user.tenantId)) });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CREAR", entidad: "aperturas", entidadId: id, valorNuevo: created, motivo: input.motivo });
    return created;
  }),

  cerrarRecepcion: procedureMutation({ capability: "publicar", role: "creador", resolveLicitacionId: (i, ctx) => licitacionIdFromApertura(i, ctx.user!.tenantId) }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "RECEPCION_CERRADA", input.motivo, { fechaCierreRecepcion: new Date() });
  }),
  sellar: procedureMutation({ capability: "publicar", role: "creador", resolveLicitacionId: (i, ctx) => licitacionIdFromApertura(i, ctx.user!.tenantId) }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const apertura = await db.query.aperturas.findFirst({ where: and(eq(aperturas.id, input.id), eq(aperturas.tenantId, ctx.user.tenantId)) });
    if (!apertura) throw new TRPCError({ code: "NOT_FOUND", message: "Apertura no encontrada." });
    assertAperturaTransition(apertura.estado as any, "SELLADA");
    const offers = await db.query.participaciones.findMany({ where: and(eq(participaciones.tenantId, ctx.user.tenantId), eq(participaciones.licitacionId, apertura.licitacionId)) });
    const frozen = await db.query.licitacionReglasVersion.findFirst({
      where: and(eq(licitacionReglasVersion.tenantId, ctx.user.tenantId), eq(licitacionReglasVersion.licitacionId, apertura.licitacionId)),
      orderBy: [desc(licitacionReglasVersion.version)],
    });
    const requisitos = parseRequisitos(frozen?.requisitos);
    const manifests: Array<{ proposicionId: number; proveedorId: number; manifestHash: string }> = [];
    // P0-01: verify existing proposicion_documentos + manifestHash — do NOT rebuild from live docs bag.
    for (const o of offers) {
      const prop = await db.query.proposiciones.findFirst({
        where: and(eq(proposiciones.tenantId, ctx.user.tenantId), eq(proposiciones.participacionId, o.id)),
      });
      if (!prop) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Participación #${o.id} sin proposición presentada; no se puede sellar.` });
      }
      if (!prop.manifestHash) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Proposición #${prop.id} sin manifestHash; presente incompleto.` });
      }
      const sealedDocs = await db.query.proposicionDocumentos.findMany({
        where: and(eq(proposicionDocumentos.tenantId, ctx.user.tenantId), eq(proposicionDocumentos.proposicionId, prop.id)),
      });
      const propDocs = sealedDocs.map((d) => ({ documentoId: d.documentoId, rol: d.rol as any, sha256: d.sha256 }));
      assertProposicionDocsCompletos(propDocs, requisitos);
      const sobre = await loadSobreForParticipacion(db, ctx.user.tenantId, o.id);
      if (!sobre?.ciphertext) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Participación #${o.id} sin sobre económico sellado.` });
      }
      const ctHash = ciphertextHash(sobre.ciphertext);
      let miembrosManifest: Array<{ proveedorId: number; rol: string; porcentajeParticipacion: string | null }> | undefined;
      if (prop.consorcioId != null) {
        const miembros = await db.query.consorcioMiembros.findMany({
          where: and(eq(consorcioMiembros.tenantId, ctx.user.tenantId), eq(consorcioMiembros.consorcioId, prop.consorcioId)),
        });
        miembrosManifest = miembros.map((m) => ({
          proveedorId: m.proveedorId,
          rol: m.rol,
          porcentajeParticipacion: m.porcentajeParticipacion != null ? String(m.porcentajeParticipacion) : null,
        }));
      }
      const { manifestHash } = buildProposicionManifest({
        proposicionId: prop.id,
        participacionId: o.id,
        proveedorId: o.proveedorId,
        ciphertextHash: ctHash,
        recibidoAt: prop.recibidoAt,
        documentos: propDocs,
        consorcioId: prop.consorcioId ?? undefined,
        consorcioMiembros: miembrosManifest,
      });
      if (manifestHash !== prop.manifestHash) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Proposición #${prop.id}: manifestHash almacenado no coincide con proposicion_documentos + sobre (posible manipulación).`,
        });
      }
      manifests.push({ proposicionId: prop.id, proveedorId: o.proveedorId, manifestHash: prop.manifestHash });
    }
    let selloHash = "";
    await db.transaction(async (tx) => {
      for (const m of manifests) {
        await tx.update(proposiciones).set({
          sealHash: m.manifestHash, sealedAt: new Date(), estado: "SELLADA",
        } as any).where(and(eq(proposiciones.id, m.proposicionId), eq(proposiciones.tenantId, ctx.user.tenantId)));
      }
      selloHash = buildAperturaSealFromProposicionManifests(manifests);
      const result = await tx.update(aperturas).set({ estado: "SELLADA", fechaSellado: new Date(), selloHash } as any)
        .where(and(eq(aperturas.id, apertura.id), eq(aperturas.tenantId, ctx.user.tenantId), eq(aperturas.estado, apertura.estado)));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "La apertura cambió de estado." });
      await appendExpedienteEvent(tx, ctx, { expedienteId: apertura.expedienteId, tipo: "APERTURA_SELLADA", estadoAnterior: apertura.estado, estadoNuevo: "SELLADA", motivo: input.motivo, payload: { aperturaId: apertura.id, selloHash, proposiciones: manifests.length } });
      const updatedInTx = await tx.query.aperturas.findFirst({ where: and(eq(aperturas.id, input.id), eq(aperturas.tenantId, ctx.user.tenantId)) });
      await writeAudit({ ctx: ctxForAudit(ctx), accion: "SELLAR", entidad: "aperturas", entidadId: input.id, valorNuevo: updatedInTx, motivo: input.motivo, tx });
    });
    return db.query.aperturas.findFirst({ where: and(eq(aperturas.id, input.id), eq(aperturas.tenantId, ctx.user.tenantId)) });
  }),
  abrir: procedureMutation({ capability: "publicar", role: "creador", resolveLicitacionId: (i, ctx) => licitacionIdFromApertura(i, ctx.user!.tenantId) }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const apertura = await db.query.aperturas.findFirst({ where: and(eq(aperturas.id, input.id), eq(aperturas.tenantId, ctx.user.tenantId)) });
    if (!apertura) throw new TRPCError({ code: "NOT_FOUND", message: "Apertura no encontrada." });
    assertAperturaTransition(apertura.estado as any, "ABIERTA");
    await db.transaction(async (tx) => {
      const result = await tx.update(aperturas).set({ estado: "ABIERTA", fechaApertura: new Date() } as any)
        .where(and(eq(aperturas.id, input.id), eq(aperturas.tenantId, ctx.user.tenantId), eq(aperturas.estado, apertura.estado)));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "La apertura cambió de estado." });
      const revealed = await revelarSobresEconomicos(tx, {
        tenantId: ctx.user.tenantId,
        licitacionId: apertura.licitacionId,
        actorUserId: ctx.user.id,
      });
      await appendExpedienteEvent(tx, ctx, {
        expedienteId: apertura.expedienteId,
        tipo: "APERTURA_ABIERTA",
        estadoAnterior: apertura.estado,
        estadoNuevo: "ABIERTA",
        motivo: input.motivo,
        payload: { aperturaId: input.id, sobresRevelados: revealed.revelados },
      });
      const updatedInTx = await tx.query.aperturas.findFirst({ where: and(eq(aperturas.id, input.id), eq(aperturas.tenantId, ctx.user.tenantId)) });
      await writeAudit({ ctx: ctxForAudit(ctx), accion: "ABRIR_REVELAR", entidad: "aperturas", entidadId: input.id, valorAnterior: apertura, valorNuevo: updatedInTx, motivo: input.motivo, tx });
    });
    return db.query.aperturas.findFirst({ where: and(eq(aperturas.id, input.id), eq(aperturas.tenantId, ctx.user.tenantId)) });
  }),
  registrarOfertas: procedureMutation({ capability: "publicar", role: "creador", resolveLicitacionId: (i, ctx) => licitacionIdFromApertura(i, ctx.user!.tenantId) }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const apertura = await db.query.aperturas.findFirst({ where: and(eq(aperturas.id, input.id), eq(aperturas.tenantId, ctx.user.tenantId)) });
    if (!apertura) throw new TRPCError({ code: "NOT_FOUND", message: "Apertura no encontrada." });
    assertAperturaTransition(apertura.estado as any, "REGISTRADA");
    const offers = await db.query.participaciones.findMany({ where: and(eq(participaciones.tenantId, ctx.user.tenantId), eq(participaciones.licitacionId, apertura.licitacionId)) });
    const frozen = await db.query.licitacionReglasVersion.findFirst({
      where: and(eq(licitacionReglasVersion.tenantId, ctx.user.tenantId), eq(licitacionReglasVersion.licitacionId, apertura.licitacionId)),
      orderBy: [desc(licitacionReglasVersion.version)],
    });
    const requisitos = parseRequisitos(frozen?.requisitos);
    // Downstream authority: sealed proposicion_documentos — NOT live documentos bag.
    for (const o of offers) {
      const prop = await db.query.proposiciones.findFirst({
        where: and(eq(proposiciones.tenantId, ctx.user.tenantId), eq(proposiciones.participacionId, o.id)),
      });
      const sealed = prop
        ? await db.query.proposicionDocumentos.findMany({
            where: and(eq(proposicionDocumentos.tenantId, ctx.user.tenantId), eq(proposicionDocumentos.proposicionId, prop.id)),
          })
        : [];
      assertProposicionSelladaCompleta(
        prop,
        sealed.map((d) => ({ documentoId: d.documentoId, rol: d.rol as any, sha256: d.sha256 })),
        requisitos,
      );
    }
    await db.transaction(async (tx) => {
      const revealed = await revelarSobresEconomicos(tx, {
        tenantId: ctx.user.tenantId,
        licitacionId: apertura.licitacionId,
        actorUserId: ctx.user.id,
      });
      for (const o of offers) {
        const monto = revealed.montos.get(o.id) ?? String(o.montoOferta);
        await tx.insert(aperturaRegistros).values({
          tenantId: ctx.user.tenantId, aperturaId: apertura.id, participacionId: o.id,
          proveedorId: o.proveedorId, montoOferta: monto, presente: true, registradoPor: ctx.user.id,
        });
      }
      const result = await tx.update(aperturas).set({ estado: "REGISTRADA", ofertasRegistradas: offers.length }).where(and(eq(aperturas.id, apertura.id), eq(aperturas.tenantId, ctx.user.tenantId), eq(aperturas.estado, "ABIERTA")));
      if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "La apertura cambió de estado." });
      await appendExpedienteEvent(tx, ctx, { expedienteId: apertura.expedienteId, tipo: "APERTURA_REGISTRADA", estadoAnterior: "ABIERTA", estadoNuevo: "REGISTRADA", motivo: input.motivo, payload: { aperturaId: apertura.id, ofertas: offers.length, sobresRevelados: revealed.revelados } });
    });
    const updated = await db.query.aperturas.findFirst({ where: and(eq(aperturas.id, input.id), eq(aperturas.tenantId, ctx.user.tenantId)), with: { registros: true } });
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "REGISTRAR", entidad: "aperturas", entidadId: input.id, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),
  emitirActa: procedureMutation({ capability: "publicar", role: "creador", resolveLicitacionId: (i, ctx) => licitacionIdFromApertura(i, ctx.user!.tenantId) }).input(z.object({ id: z.number().int().positive(), actaResumen: z.string().trim().min(10), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "ACTA_EMITIDA", input.motivo, { fechaActa: new Date(), actaResumen: input.actaResumen });
  }),
  publicar: procedureMutation({ capability: "publicar", role: "creador", resolveLicitacionId: (i, ctx) => licitacionIdFromApertura(i, ctx.user!.tenantId) }).input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    return transition(ctx, input.id, "PUBLICADA", input.motivo, { fechaPublicacion: new Date() });
  }),
});

async function transition(ctx: any, id: number, next: string, motivo: string, patch: Record<string, unknown>) {
  const db = getDb();
  const apertura = await db.query.aperturas.findFirst({ where: and(eq(aperturas.id, id), eq(aperturas.tenantId, ctx.user.tenantId)) });
  if (!apertura) throw new TRPCError({ code: "NOT_FOUND", message: "Apertura no encontrada." });
  assertAperturaTransition(apertura.estado as any, next as any);
  await db.transaction(async (tx) => {
    const result = await tx.update(aperturas).set({ ...patch, estado: next } as any).where(and(eq(aperturas.id, id), eq(aperturas.tenantId, ctx.user.tenantId), eq(aperturas.estado, apertura.estado)));
    if (Number(result[0]?.affectedRows ?? 0) !== 1) throw new TRPCError({ code: "CONFLICT", message: "La apertura cambió de estado." });
    await appendExpedienteEvent(tx, ctx, { expedienteId: apertura.expedienteId, tipo: `APERTURA_${next}`, estadoAnterior: apertura.estado, estadoNuevo: next, motivo, payload: { aperturaId: id } });
  });
  const updated = await db.query.aperturas.findFirst({ where: and(eq(aperturas.id, id), eq(aperturas.tenantId, ctx.user.tenantId)) });
  await writeAudit({ ctx: ctxForAudit(ctx), accion: "TRANSICION", entidad: "aperturas", entidadId: id, valorAnterior: apertura, valorNuevo: updated, motivo });
  return updated;
}
