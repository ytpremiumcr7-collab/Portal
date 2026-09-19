import { and, eq, lte } from "drizzle-orm";
import { domainOutbox, notificaciones, notificacionDestinatarios, proveedores } from "@db/schema";

export const OUTBOX_EVENT_TYPES = [
  "FALLO_PUBLICADO",
  "ADJUDICACION",
  "CONTRATO_FORMALIZADO",
  "CONTRATO_RESCINDIDO",
  "SANCION_EMITIDA",
  "INCONFORMIDAD_PRESENTADA",
  "INCONFORMIDAD_RESUELTA",
  "PROCEDIMIENTO_CANCELADO",
  "PROCEDIMIENTO_DESIERTO",
  "ACTO_ADJUDICACION_PUBLICADO",
] as const;

export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

/** Server-derived legal effect — never client-controlled. */
export function efectoLegalFromEventType(eventType: string): boolean {
  return (OUTBOX_EVENT_TYPES as readonly string[]).includes(eventType);
}

export async function enqueueOutbox(
  tx: any,
  input: {
    tenantId: number;
    aggregateType: string;
    aggregateId: number;
    eventType: OutboxEventType | string;
    payload: Record<string, unknown>;
  },
) {
  await tx.insert(domainOutbox).values({
    tenantId: input.tenantId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    payload: input.payload,
    status: "PENDING",
    attempts: 0,
    nextAttemptAt: new Date(),
  });
}

export type DeliveryAdapter = {
  name: "log" | "noop" | "smtp";
  send: (msg: {
    to: string;
    subject: string;
    body: string;
    eventType: string;
  }) => Promise<{ ok: boolean; external: boolean }>;
};

export const logAdapter: DeliveryAdapter = {
  name: "log",
  async send(msg) {
    console.info("[outbox:log-adapter]", msg.eventType, msg.to, msg.subject);
    return { ok: true, external: false };
  },
};

export const noopAdapter: DeliveryAdapter = {
  name: "noop",
  async send() {
    return { ok: true, external: false };
  },
};

/**
 * SMTP / webhook delivery adapter.
 * - ARES_SMTP_URL unset → REGISTRADA (external:false)
 * - http(s):// → POST JSON webhook {to,subject,body,eventType}
 * - smtp:// or smtps:// → nodemailer transport (optional dependency)
 */
export const smtpAdapter: DeliveryAdapter = {
  name: "smtp",
  async send(msg) {
    const url = process.env.ARES_SMTP_URL?.trim();
    if (!url) {
      console.info("[outbox:smtp-adapter] ARES_SMTP_URL unset — remaining REGISTRADA", msg.to, msg.subject);
      return { ok: true, external: false };
    }
    try {
      if (/^https?:\/\//i.test(url)) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            to: msg.to,
            subject: msg.subject,
            body: msg.body,
            eventType: msg.eventType,
            product: "Piedra Angular",
          }),
        });
        if (!res.ok) {
          console.error("[outbox:smtp-adapter] webhook HTTP", res.status, await res.text().catch(() => ""));
          return { ok: false, external: false };
        }
        console.info("[outbox:smtp-adapter] ENVIADA_EXTERNA webhook", msg.to, msg.subject);
        return { ok: true, external: true };
      }
      // smtp://user:pass@host:587 or smtps://
      let nodemailer: any;
      try {
        nodemailer = await import("nodemailer");
      } catch {
        console.error("[outbox:smtp-adapter] nodemailer no instalado — deje REGISTRADA. npm i nodemailer");
        return { ok: true, external: false };
      }
      const transport = nodemailer.createTransport(url);
      const from = process.env.ARES_SMTP_FROM || "noreply@piedra-angular.gob.mx";
      await transport.sendMail({
        from,
        to: msg.to,
        subject: msg.subject,
        text: msg.body,
      });
      console.info("[outbox:smtp-adapter] ENVIADA_EXTERNA smtp", msg.to, msg.subject);
      return { ok: true, external: true };
    } catch (e: any) {
      console.error("[outbox:smtp-adapter] fallo de entrega", e?.message ?? e);
      return { ok: false, external: false };
    }
  },
};

/**
 * Drain PENDING outbox → create notification as REGISTRADA.
 * ENVIADA_EXTERNA only when adapter reports external success.
 */
export async function processOutboxOnce(
  db: any,
  opts: { limit?: number; adapter?: DeliveryAdapter; actorUserId?: number } = {},
) {
  const adapter = opts.adapter ?? logAdapter;
  const limit = opts.limit ?? 50;
  const now = new Date();
  const rows = await db
    .select()
    .from(domainOutbox)
    .where(and(eq(domainOutbox.status, "PENDING"), lte(domainOutbox.nextAttemptAt, now)))
    .orderBy(domainOutbox.id)
    .limit(limit);

  let processed = 0;
  for (const row of rows) {
    const claimed = await db
      .update(domainOutbox)
      .set({ status: "PROCESSING", attempts: Number(row.attempts) + 1 })
      .where(and(eq(domainOutbox.id, row.id), eq(domainOutbox.status, "PENDING")));
    const affected = Number(claimed?.[0]?.affectedRows ?? 0);
    if (affected === 0) {
      // Another worker claimed this row — abort this iteration (do not continue processing).
      continue;
    }

    try {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const proveedorId = payload.proveedorId != null ? Number(payload.proveedorId) : null;
      let email: string | null = (payload.email as string) ?? null;
      if (!email && proveedorId) {
        const prov = await db.query.proveedores.findFirst({
          where: and(eq(proveedores.id, proveedorId), eq(proveedores.tenantId, row.tenantId)),
        });
        email = (prov as any)?.email ?? null;
      }

      const asunto = String(payload.asunto ?? `Evento ${row.eventType}`);
      const cuerpo = String(payload.cuerpo ?? JSON.stringify(payload));
      const actorUserId =
        Number(payload.actorUserId ?? opts.actorUserId ?? 0) || Number(opts.actorUserId ?? 1);

      const insertResult = await db.insert(notificaciones).values({
        tenantId: row.tenantId,
        templateId: null,
        codigoEvento: row.eventType,
        asunto,
        cuerpo,
        efectoLegal: efectoLegalFromEventType(row.eventType),
        entidadRef: String(payload.entidadRef ?? row.aggregateType),
        entidadId: Number(payload.entidadId ?? row.aggregateId),
        licitacionId: payload.licitacionId != null ? Number(payload.licitacionId) : null,
        estado: "REGISTRADA",
        creadaPor: actorUserId,
        enviadaAt: null,
      } as any);
      const notifId = Number(insertResult[0].insertId);

      let externalOk = false;
      if (email) {
        await db.insert(notificacionDestinatarios).values({
          tenantId: row.tenantId,
          notificacionId: notifId,
          email,
          proveedorId,
          deliveryStatus: "PENDIENTE",
        } as any);
        const result = await adapter.send({
          to: email,
          subject: asunto,
          body: cuerpo,
          eventType: row.eventType,
        });
        if (result.ok && result.external) {
          externalOk = true;
          await db
            .update(notificaciones)
            .set({ estado: "ENVIADA_EXTERNA", enviadaAt: new Date() } as any)
            .where(eq(notificaciones.id, notifId));
          await db
            .update(notificacionDestinatarios)
            .set({ deliveryStatus: "ENVIADO" } as any)
            .where(eq(notificacionDestinatarios.notificacionId, notifId));
        }
      }

      await db
        .update(domainOutbox)
        .set({
          status: "SENT",
          processedAt: new Date(),
          lastError: externalOk ? null : `registered_via_${adapter.name}_no_external`,
        } as any)
        .where(eq(domainOutbox.id, row.id));
      processed += 1;
    } catch (e: any) {
      const attempts = Number(row.attempts) + 1;
      const backoffMin = Math.min(60, 2 ** Math.min(attempts, 5));
      await db
        .update(domainOutbox)
        .set({
          status: attempts >= 8 ? "FAILED" : "PENDING",
          lastError: String(e?.message ?? e),
          nextAttemptAt: new Date(Date.now() + backoffMin * 60_000),
        } as any)
        .where(eq(domainOutbox.id, row.id));
    }
  }
  return { processed, scanned: rows.length };
}
