import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, ctxForAudit } from "../middleware";
import { getDb } from "../queries/connection";
import { firmasElectronicas, licitacionReglasVersion, licitaciones } from "@db/schema";
import { createFirmaElectronica, policyRequiresCryptoFirma, verifyFirmaRecord, labelForSignatureKind } from "../lib/firmas-electronicas";
import { getSignatureProvider, loadSatCasBundle } from "../lib/firma";
import { writeAudit } from "../lib/security";
import { mergeModalidadRequisitos } from "../lib/procedure-policy";

const cryptoInput = z.object({
  cerBase64: z.string().min(32),
  keyBase64: z.string().min(32),
  password: z.string().min(1),
  p7mBase64: z.string().min(32).optional(),
});

export const firmasRouter = createRouter({
  /** Provider status — honest NOT_CONFIGURED when SAT CAs missing. */
  providerStatus: authedQuery.query(async () => {
    const bundle = loadSatCasBundle();
    const sat = getSignatureProvider("CRYPTO_SIGNATURE");
    return {
      session: { name: "SessionConfirmationProvider", kind: "SESSION_CONFIRMATION", configured: true },
      crypto: {
        name: sat.name,
        kind: "CRYPTO_SIGNATURE",
        configured: sat.isConfigured(),
        detail: bundle.configured
          ? `issuers=${bundle.issuers.length} ocspSigners=${bundle.ocspSigners.length}`
          : `NOT_CONFIGURED: ${bundle.missing.join("; ")}`,
        labels: {
          session: labelForSignatureKind("SESSION_CONFIRMATION"),
          crypto: labelForSignatureKind("CRYPTO_SIGNATURE"),
        },
      },
    };
  }),

  listByEntidad: authedQuery.input(z.object({
    entidadRef: z.string().trim().min(2).max(64),
    entidadId: z.number().int().positive(),
  })).query(async ({ input, ctx }) => {
    const db = getDb();
    return db.query.firmasElectronicas.findMany({
      where: and(
        eq(firmasElectronicas.tenantId, ctx.user.tenantId),
        eq(firmasElectronicas.entidadRef, input.entidadRef),
        eq(firmasElectronicas.entidadId, input.entidadId),
      ),
      orderBy: [desc(firmasElectronicas.signedAt)],
      columns: {
        // Never expose nothing secret — keys are never stored; omit bulky PEM optionally
        id: true, kind: true, documentDigest: true, algorithm: true,
        validationStatus: true, certSerial: true, signerRfc: true,
        signerUserId: true, signedAt: true, motivo: true,
        signatureValue: true, // p7m base64 is public evidence
      },
    });
  }),

  /**
   * Register e.firma for a juridical act / proposición.
   * Accepts base64 cer+key+password OR pre-built p7m (verify via attach).
   * When policy requires CRYPTO, SESSION is rejected.
   */
  firmar: authedQuery.input(z.object({
    entidadRef: z.string().trim().min(2).max(64),
    entidadId: z.number().int().positive(),
    documentoId: z.number().int().positive().optional(),
    kind: z.enum(["SESSION_CONFIRMATION", "CRYPTO_SIGNATURE"]).default("SESSION_CONFIRMATION"),
    payload: z.unknown(),
    motivo: z.string().trim().min(3),
    /** When signing proposición/acto linked to a licitacion — used for policy crypto flag. */
    licitacionId: z.number().int().positive().optional(),
    requireCrypto: z.boolean().optional(),
    crypto: cryptoInput.optional(),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    let requireCrypto = !!input.requireCrypto || input.kind === "CRYPTO_SIGNATURE";

    if (input.licitacionId) {
      const lic = await db.query.licitaciones.findFirst({
        where: and(eq(licitaciones.id, input.licitacionId), eq(licitaciones.tenantId, ctx.user.tenantId)),
      });
      const frozen = await db.query.licitacionReglasVersion.findFirst({
        where: and(
          eq(licitacionReglasVersion.tenantId, ctx.user.tenantId),
          eq(licitacionReglasVersion.licitacionId, input.licitacionId),
        ),
        orderBy: [desc(licitacionReglasVersion.version)],
      });
      const merged = mergeModalidadRequisitos(
        (frozen as any)?.requisitos ?? null,
        (lic as any)?.modalidadMeta ?? null,
      );
      if (policyRequiresCryptoFirma(merged)) requireCrypto = true;
    }

    if (requireCrypto && input.kind !== "CRYPTO_SIGNATURE") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "La política exige CRYPTO_SIGNATURE (e.firma). SESSION_CONFIRMATION rechazada.",
      });
    }
    if (input.kind === "CRYPTO_SIGNATURE" && !input.crypto) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "CRYPTO_SIGNATURE requiere crypto.cerBase64 + keyBase64 + password (o p7mBase64).",
      });
    }

    let created: Awaited<ReturnType<typeof createFirmaElectronica>>;
    await db.transaction(async (tx) => {
      created = await createFirmaElectronica(tx, {
        tenantId: ctx.user.tenantId,
        documentoId: input.documentoId ?? null,
        entidadRef: input.entidadRef,
        entidadId: input.entidadId,
        kind: input.kind,
        payload: input.payload,
        signerUserId: ctx.user.id,
        motivo: input.motivo,
        requireCrypto,
        crypto: input.crypto
          ? {
              cer: Buffer.from(input.crypto.cerBase64.replace(/\s+/g, ""), "base64"),
              key: Buffer.from(input.crypto.keyBase64.replace(/\s+/g, ""), "base64"),
              password: input.crypto.password,
              p7mBase64: input.crypto.p7mBase64,
            }
          : undefined,
      });
      await writeAudit({
        ctx: ctxForAudit(ctx),
        accion: "FIRMAR",
        entidad: "firmas_electronicas",
        entidadId: created.id,
        valorNuevo: {
          kind: created.kind,
          validationStatus: created.validationStatus,
          certSerial: created.certSerial,
          signerRfc: created.signerRfc,
          // never audit password/key
        },
        motivo: input.motivo,
        tx,
      });
    });

    return created!;
  }),

  verify: authedQuery.input(z.object({
    firmaId: z.number().int().positive(),
    payload: z.unknown().optional(),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const row = await db.query.firmasElectronicas.findFirst({
      where: and(eq(firmasElectronicas.id, input.firmaId), eq(firmasElectronicas.tenantId, ctx.user.tenantId)),
    });
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Firma no encontrada." });
    const result = await verifyFirmaRecord({
      kind: row.kind as any,
      documentDigest: row.documentDigest,
      signatureValue: row.signatureValue,
      certificatePem: row.certificatePem,
      payload: input.payload,
    });
    const statusMap: Record<string, "PENDING" | "VALID" | "INVALID" | "NOT_APPLICABLE"> = {
      VALID: "VALID",
      INVALID: "INVALID",
      NOT_APPLICABLE: "NOT_APPLICABLE",
      PENDING: "PENDING",
      NOT_CONFIGURED: "PENDING",
    };
    if (result.ocspEvidence || result.status) {
      await db.update(firmasElectronicas).set({
        validationStatus: statusMap[result.status] ?? row.validationStatus,
        ocspEvidence: result.ocspEvidence ?? (row as any).ocspEvidence,
      } as any).where(and(eq(firmasElectronicas.id, row.id), eq(firmasElectronicas.tenantId, ctx.user.tenantId)));
    }
    return result;
  }),
});
