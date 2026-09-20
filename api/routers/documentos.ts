import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRouter, capabilityQuery, authedQuery, adminQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { documentos, proposicionDocumentos, proveedores, expedientes } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { pageInput, pageResult } from "../lib/pagination";
import { appendExpedienteEvent, findExpedienteByLicitacion, refreshRequirementStatuses } from "../lib/expediente";
import { writeAudit } from "../lib/security";
import { detectMimeFromMagic, assertMimeAllowed } from "../lib/mime-detect";
import { authorizeDocumentRead, filterReadableDocuments, assertOfertaUploadAllowed } from "../lib/document-access";

const MAX_BYTES = 20 * 1024 * 1024;
const allowedTypes = ["CONVOCATORIA","FUNDAMENTO_JURIDICO","PLIEGO_TECNICO","PLIEGO_ADMINISTRATIVO","JUNTA_ACLARACIONES","ACTA_APERTURA","OFERTA_TECNICA","OFERTA_ECONOMICA","GARANTIA","ACTA_EVALUACION","DICTAMEN","FALLO_ADJUDICACION","CONTRATO","FACTURA","OTRO"] as const;
const uploadSchema = z.object({ expedienteId: z.number().int().positive().optional(), licitacionId: z.number().int().positive().optional(), proveedorId: z.number().int().positive().optional(), tipo: z.enum(allowedTypes), nombreArchivo: z.string().trim().min(1).max(255), mimeType: z.string().trim().min(1).max(120), contentBase64: z.string().min(10), esPublico: z.boolean().default(false), motivo: z.string().trim().optional(), reemplazaDocumentoId: z.number().int().positive().optional() }).superRefine((v, ctx) => { if (!v.expedienteId && !v.licitacionId && !v.proveedorId) ctx.addIssue({ code: "custom", message: "El documento debe vincularse a un expediente, licitación o proveedor." }); });

async function resolveExpediente(tenantId: number, expedienteId?: number, licitacionId?: number) {
  if (expedienteId) {
    const e = await getDb().query.expedientes.findFirst({ where: and(eq(expedientes.id, expedienteId), eq(expedientes.tenantId, tenantId)) });
    if (!e) throw new TRPCError({ code: "NOT_FOUND", message: "Expediente no encontrado." });
    return e;
  }
  if (licitacionId) {
    const e = await findExpedienteByLicitacion(tenantId, licitacionId);
    if (!e) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La licitación no tiene expediente electrónico." });
    return e;
  }
  return null;
}

export const documentosRouter = createRouter({
  list: authedQuery.input(z.object({ expedienteId: z.number().int().positive().optional(), licitacionId: z.number().int().positive().optional(), proveedorId: z.number().int().positive().optional(), estado: z.enum(["PENDIENTE","VALIDANDO","APROBADO","RECHAZADO","OBSOLETO"]).optional(), vigentes: z.boolean().optional(), page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(100).optional() }).optional()).query(async ({ input, ctx }) => {
    const { page, pageSize, offset } = pageInput(input?.page, input?.pageSize);
    const conditions = [eq(documentos.tenantId, ctx.user.tenantId)];
    const expediente = await resolveExpediente(ctx.user.tenantId, input?.expedienteId, input?.licitacionId);
    if (expediente) conditions.push(eq(documentos.expedienteId, expediente.id));
    if (ctx.user.role === "proveedor") {
      const provider = await getDb().query.proveedores.findFirst({ where: and(eq(proveedores.tenantId, ctx.user.tenantId), eq(proveedores.usuarioId, ctx.user.id), eq(proveedores.activo, true)) });
      if (!provider) throw new TRPCError({ code: "FORBIDDEN", message: "Proveedor sin expediente asociado." });
      conditions.push(eq(documentos.proveedorId, provider.id));
      conditions.push(eq(documentos.esVersionVigente, true));
    } else {
      if (input?.proveedorId) conditions.push(eq(documentos.proveedorId, input.proveedorId));
      if (input?.vigentes !== false) conditions.push(eq(documentos.esVersionVigente, true));
    }
    if (input?.estado) conditions.push(eq(documentos.estado, input.estado));
    const where = and(...conditions); const db = getDb();
    const [items, totalRows] = await Promise.all([db.query.documentos.findMany({ where, orderBy: [desc(documentos.fechaSubida)], limit: pageSize, offset, with: { expediente: true, licitacion: true, proveedor: true, usuario: true } }), db.select({ total: count() }).from(documentos).where(where)]);
    const readable = await filterReadableDocuments(
      { id: ctx.user.id, tenantId: ctx.user.tenantId, role: ctx.user.role },
      items as any[],
    );
    // Preserve pagination total as pre-filter count for UX stability; items are authz-filtered.
    return pageResult(readable, Number(totalRows[0]?.total ?? 0), page, pageSize);
  }),

  getById: authedQuery.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const db = getDb(); const doc = await db.query.documentos.findFirst({ where: and(eq(documentos.id, input.id), eq(documentos.tenantId, ctx.user.tenantId)), with: { expediente: true, licitacion: true, proveedor: true, usuario: true } });
    if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Documento no encontrado." });
    await authorizeDocumentRead(
      { id: ctx.user.id, tenantId: ctx.user.tenantId, role: ctx.user.role },
      doc as any,
    );
    return doc;
  }),

  upload: authedQuery.input(uploadSchema).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const expediente = await resolveExpediente(ctx.user.tenantId, input.expedienteId, input.licitacionId);
    if (expediente && input.licitacionId && expediente.licitacionId !== input.licitacionId) throw new TRPCError({ code: "BAD_REQUEST", message: "El expediente y la licitación indicada no corresponden al mismo aggregate." });
    if (ctx.user.role === "proveedor") {
      if (!input.proveedorId) throw new TRPCError({ code: "BAD_REQUEST", message: "Un proveedor debe vincular cada documento a su expediente de proveedor." });
      const provider = await db.query.proveedores.findFirst({ where: and(eq(proveedores.tenantId, ctx.user.tenantId), eq(proveedores.id, input.proveedorId), eq(proveedores.usuarioId, ctx.user.id), eq(proveedores.activo, true)) });
      if (!provider) throw new TRPCError({ code: "FORBIDDEN", message: "El documento no pertenece a su expediente." });
      if (!["OFERTA_TECNICA","OFERTA_ECONOMICA","GARANTIA"].includes(input.tipo)) throw new TRPCError({ code: "FORBIDDEN", message: "El rol proveedor sólo puede cargar oferta técnica, oferta económica o garantía." });
      await assertOfertaUploadAllowed({
        tenantId: ctx.user.tenantId,
        proveedorId: provider.id,
        licitacionId: input.licitacionId ?? expediente?.licitacionId ?? null,
        tipo: input.tipo,
      });
      if (input.esPublico) throw new TRPCError({ code: "FORBIDDEN", message: "Los documentos de proveedor no pueden publicarse directamente." });
    }
    if (input.reemplazaDocumentoId && !expediente) throw new TRPCError({ code: "BAD_REQUEST", message: "La sustitución documental requiere expediente." });
    if (input.reemplazaDocumentoId) {
      const old = await db.query.documentos.findFirst({ where: and(eq(documentos.id, input.reemplazaDocumentoId), eq(documentos.tenantId, ctx.user.tenantId), eq(documentos.expedienteId, expediente!.id)) });
      if (!old) throw new TRPCError({ code: "NOT_FOUND", message: "Versión documental a sustituir no encontrada." });
      if (!old.esVersionVigente) throw new TRPCError({ code: "CONFLICT", message: "Sólo se puede sustituir la versión vigente." });
      if (old.tipo !== input.tipo) throw new TRPCError({ code: "BAD_REQUEST", message: "La nueva versión debe conservar el tipo documental." });
      // Any doc sealed into a proposición manifest (incl. ANEXO/GARANTIA) is immutable.
      const sealed = await db.query.proposicionDocumentos.findFirst({
        where: and(eq(proposicionDocumentos.tenantId, ctx.user.tenantId), eq(proposicionDocumentos.documentoId, input.reemplazaDocumentoId)),
        columns: { id: true },
      });
      if (sealed) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Documento sellado en proposición (manifest); no puede sustituirse tras presentación.",
        });
      }
    }
    const buffer = Buffer.from(input.contentBase64.replace(/^data:.*;base64,/, ""), "base64");
    if (!buffer.length || buffer.length > MAX_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "El archivo debe tener entre 1 byte y 20 MB." });
        const detectedMime = detectMimeFromMagic(buffer, input.mimeType);
    assertMimeAllowed(detectedMime);
const sha256 = createHash("sha256").update(buffer).digest("hex");
    const previous = input.reemplazaDocumentoId ? await db.query.documentos.findFirst({ where: and(eq(documentos.id, input.reemplazaDocumentoId), eq(documentos.tenantId, ctx.user.tenantId)) }) : null;
    const versionGroup = previous?.versionGroup ?? randomUUID();
    const version = previous ? previous.version + 1 : 1;
    const storageKey = `tenants/${ctx.user.tenantId}/documents/${randomUUID()}-${input.nombreArchivo.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const fullPath = path.resolve(process.env.ARES_STORAGE_PATH || "./storage", storageKey);
    await mkdir(path.dirname(fullPath), { recursive: true }); await writeFile(fullPath, buffer, { flag: "wx" });
    try {
      const createdId = await db.transaction(async tx => {
        if (previous) await tx.update(documentos).set({ esVersionVigente: false, estado: "OBSOLETO" }).where(and(eq(documentos.id, previous.id), eq(documentos.tenantId, ctx.user.tenantId), eq(documentos.esVersionVigente, true)));
        const result = await tx.insert(documentos).values({ tenantId: ctx.user.tenantId, expedienteId: expediente?.id ?? null, licitacionId: input.licitacionId ?? expediente?.licitacionId ?? null, proveedorId: input.proveedorId ?? null, tipo: input.tipo, version, versionGroup, previousVersionId: previous?.id ?? null, esVersionVigente: true, nombreArchivo: input.nombreArchivo, mimeType: detectedMime, mimeDetectado: detectedMime, tamanoBytes: buffer.byteLength, sha256, storageKey, esPublico: input.esPublico, estado: "PENDIENTE", subidoPor: ctx.user.id });
        const id = Number(result[0].insertId);
        if (expediente) { await appendExpedienteEvent(tx, ctx, { expedienteId: expediente.id, tipo: previous ? "NUEVA_VERSION_DOCUMENTAL" : "DOCUMENTO_AGREGADO", motivo: input.motivo ?? null, payload: { documentoId: id, tipo: input.tipo, version, sha256, previousVersionId: previous?.id ?? null } }); }
        return id;
      });
      const created = await db.query.documentos.findFirst({ where: and(eq(documentos.id, createdId), eq(documentos.tenantId, ctx.user.tenantId)), with: { expediente: true, licitacion: true, proveedor: true, usuario: true } });
      if (expediente) await refreshRequirementStatuses(db, ctx.user.tenantId, expediente.id);
      await writeAudit({ ctx: ctxForAudit(ctx), accion: previous ? "NUEVA_VERSION" : "SUBIR", entidad: "documentos", entidadId: created?.id, valorNuevo: created, motivo: input.motivo });
      return created;
    } catch (error) { try { await unlink(fullPath); } catch {} throw error; }
  }),

  cambiarEstado: capabilityQuery("aprobar_juridico").input(z.object({ id: z.number().int().positive(), estado: z.enum(["VALIDANDO","APROBADO","RECHAZADO","OBSOLETO"]), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb(); const current = await db.query.documentos.findFirst({ where: and(eq(documentos.id, input.id), eq(documentos.tenantId, ctx.user.tenantId)) });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Documento no encontrado." });
    if (!current.esVersionVigente && input.estado !== "OBSOLETO") throw new TRPCError({ code: "CONFLICT", message: "Sólo la versión vigente puede validarse." });
    const allowed: Record<string,string[]> = { PENDIENTE:["VALIDANDO","RECHAZADO"], VALIDANDO:["APROBADO","RECHAZADO"], RECHAZADO:["VALIDANDO"], APROBADO:["OBSOLETO"], OBSOLETO:[] };
    if (!allowed[current.estado]?.includes(input.estado)) throw new TRPCError({ code: "CONFLICT", message: `Transición documental no permitida: ${current.estado} → ${input.estado}.` });
    const data = input.estado === "RECHAZADO" ? { estado: input.estado, motivoRechazo: input.motivo } : { estado: input.estado, motivoRechazo: null, ...(input.estado === "OBSOLETO" ? { esVersionVigente: false } : {}) };
    await db.transaction(async (tx) => {
      await tx.update(documentos).set(data).where(and(eq(documentos.id, input.id), eq(documentos.tenantId, ctx.user.tenantId), eq(documentos.esVersionVigente, true)));
      if (current.expedienteId) {
        await appendExpedienteEvent(tx, ctx, { expedienteId: current.expedienteId!, tipo: "ESTADO_DOCUMENTAL", motivo: input.motivo, payload: { documentoId: current.id, from: current.estado, to: input.estado, version: current.version } });
      }
    });
    const updated = await db.query.documentos.findFirst({ where: and(eq(documentos.id, input.id), eq(documentos.tenantId, ctx.user.tenantId)), with: { expediente: true } });
    if (current.expedienteId) await refreshRequirementStatuses(db, ctx.user.tenantId, current.expedienteId);
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "CAMBIAR_ESTADO", entidad: "documentos", entidadId: input.id, valorAnterior: current, valorNuevo: updated, motivo: input.motivo });
    return updated;
  }),

  delete: adminQuery.input(z.object({ id: z.number().int().positive(), motivo: z.string().trim().min(3) })).mutation(async ({ input, ctx }) => {
    const db = getDb(); const current = await db.query.documentos.findFirst({ where: and(eq(documentos.id, input.id), eq(documentos.tenantId, ctx.user.tenantId)) });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Documento no encontrado." });
    if (current.expedienteId || current.estado === "APROBADO" || current.estado === "OBSOLETO") throw new TRPCError({ code: "CONFLICT", message: "Un documento de expediente no se elimina físicamente; debe sustituirse o quedar obsoleto para conservar evidencia." });
    await db.delete(documentos).where(and(eq(documentos.id, input.id), eq(documentos.tenantId, ctx.user.tenantId)));
    try { await unlink(path.resolve(process.env.ARES_STORAGE_PATH || "./storage", current.storageKey)); } catch {}
    await writeAudit({ ctx: ctxForAudit(ctx), accion: "ELIMINAR", entidad: "documentos", entidadId: input.id, valorAnterior: current, motivo: input.motivo });
    return { success: true };
  }),
});
