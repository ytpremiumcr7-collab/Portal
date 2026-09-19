import { and, eq, lte, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
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

import { SYSTEM_ACTOR_EMAIL, SYSTEM_ACTOR_SENTINEL, ensureSystemActor, systemActorEmail } from "./system-actor";
export { SYSTEM_ACTOR_EMAIL, SYSTEM_ACTOR_SENTINEL, ensureSystemActor, systemActorEmail };

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
    idempotencyKey?: string;
  },
) {
  const idem =
    input.idempotencyKey ??
    `${input.eventType}:${input.aggregateType}:${input.aggregateId}:${input.tenantId}`;
  await tx.insert(domainOutbox).values({
    tenantId: input.tenantId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    payload: input.payload,
    status: "PENDING",
    attempts: 0,
    nextAttemptAt: new Date(),
    idempotencyKey: idem,
  } as any);
}

export type DeliveryAdapter = {
  name: "log" | "noop" | "smtp";
  send: (msg: {
    to: string;
    subject: string;
    body: string;
    eventType: string;
    /** Outbox row id — used as Idempotency-Key to avoid double logical send. */
    outboxId?: number;
  }) => Promise<{ ok: boolean; external: boolean; messageId?: string | null }>;
};

/**
 * SMTP delivery is at-least-once: the worker may retry after lease reclaim or crash
 * between provider accept and local SENT mark. Consumers MUST treat Idempotency-Key
 * (outbox id) as the dedupe key. Webhook adapters receive the same header.
 */

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

function resolveSmtpConfig(): {
  mode: "unset" | "webhook" | "smtp";
  url?: string;
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  from: string;
  secure?: boolean;
} {
  const from =
    process.env.ARES_SMTP_FROM?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    "noreply@piedra-angular.gob.mx";
  const url = process.env.ARES_SMTP_URL?.trim();
  if (url) {
    if (/^https?:\/\//i.test(url)) return { mode: "webhook", url, from };
    return { mode: "smtp", url, from };
  }
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return { mode: "unset", from };
  return {
    mode: "smtp",
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER?.trim(),
    pass: process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD,
    from,
    secure: process.env.SMTP_SECURE === "true" || Number(process.env.SMTP_PORT) === 465,
  };
}

/**
 * Production SMTP / webhook delivery adapter.
 * - unset → REGISTRADA (external:false)
 * - http(s):// → POST JSON webhook
 * - smtp(s):// or SMTP_HOST discrete → nodemailer with TLS + timeouts
 * ENVIADA_EXTERNA only when adapter reports external success.
 */
export const smtpAdapter: DeliveryAdapter = {
  name: "smtp",
  async send(msg) {
    const cfg = resolveSmtpConfig();
    if (cfg.mode === "unset") {
      console.info("[outbox:smtp-adapter] SMTP unset — remaining REGISTRADA", {
        to: msg.to,
        subject: msg.subject,
        eventType: msg.eventType,
      });
      return { ok: true, external: false };
    }
    try {
      if (cfg.mode === "webhook" && cfg.url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Number(process.env.SMTP_TIMEOUT_MS ?? 15_000));
        try {
          const headers: Record<string, string> = {
            "content-type": "application/json",
            accept: "application/json",
          };
          if (msg.outboxId != null) headers["Idempotency-Key"] = String(msg.outboxId);
          const res = await fetch(cfg.url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              to: msg.to,
              subject: msg.subject,
              body: msg.body,
              eventType: msg.eventType,
              product: "Piedra Angular",
              from: cfg.from,
              outboxId: msg.outboxId ?? null,
            }),
            signal: controller.signal,
          });
          if (!res.ok) {
            console.error("[outbox:smtp-adapter] webhook HTTP", { status: res.status, to: msg.to });
            return { ok: false, external: false };
          }
          let messageId: string | null = null;
          try {
            const j = await res.json() as any;
            messageId = j?.messageId ?? j?.id ?? null;
          } catch { /* ignore */ }
          console.info("[outbox:smtp-adapter] ENVIADA_EXTERNA webhook", { to: msg.to, subject: msg.subject, messageId });
          return { ok: true, external: true, messageId };
        } finally {
          clearTimeout(timer);
        }
      }

      let nodemailer: any;
      try {
        nodemailer = await import("nodemailer");
      } catch {
        console.error("[outbox:smtp-adapter] nodemailer no instalado — deje REGISTRADA");
        return { ok: true, external: false };
      }

      const timeout = Number(process.env.SMTP_TIMEOUT_MS ?? 15_000);
      const transport = cfg.url
        ? nodemailer.createTransport(cfg.url, { connectionTimeout: timeout, greetingTimeout: timeout, socketTimeout: timeout })
        : nodemailer.createTransport({
            host: cfg.host,
            port: cfg.port,
            secure: !!cfg.secure,
            auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
            connectionTimeout: timeout,
            greetingTimeout: timeout,
            socketTimeout: timeout,
            tls: { minVersion: "TLSv1.2" },
          });

      const info = await transport.sendMail({
        from: cfg.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.body,
      });
      const messageId = info?.messageId ?? null;
      console.info("[outbox:smtp-adapter] ENVIADA_EXTERNA smtp", {
        to: msg.to,
        subject: msg.subject,
        messageId,
        accepted: info?.accepted,
      });
      return { ok: true, external: true, messageId };
    } catch (e: any) {
      console.error("[outbox:smtp-adapter] fallo de entrega", {
        error: e?.message ?? String(e),
        to: msg.to,
        eventType: msg.eventType,
      });
      return { ok: false, external: false };
    }
  },
};

async function resolveSystemActorUserId(db: any, tenantId: number, preferred?: number | null): Promise<number | typeof SYSTEM_ACTOR_SENTINEL> {
  if (preferred && Number(preferred) > 0) return Number(preferred);
  try {
    const ensured = await ensureSystemActor(db, tenantId);
    if (ensured?.id) return ensured.id;
  } catch (e: any) {
    console.warn("[outbox] ensureSystemActor failed", { tenantId, error: e?.message ?? e, hint: systemActorEmail(tenantId) });
  }
  // Fail closed — never invent actorUserId=1
  return SYSTEM_ACTOR_SENTINEL;
}

const DEFAULT_LEASE_MINUTES = Number(process.env.OUTBOX_LEASE_MINUTES ?? 15);

/** Reclaim PROCESSING rows whose lease (claimedAt) is older than N minutes. */
export async function reclaimStaleOutboxClaims(db: any, leaseMinutes = DEFAULT_LEASE_MINUTES) {
  const cutoff = new Date(Date.now() - leaseMinutes * 60_000);
  const result = await db
    .update(domainOutbox)
    .set({
      status: "PENDING",
      claimedAt: null,
      claimedBy: null,
      lastError: `lease_reclaimed_after_${leaseMinutes}m`,
    } as any)
    .where(and(eq(domainOutbox.status, "PROCESSING"), lt(domainOutbox.claimedAt, cutoff)));
  return Number(result?.[0]?.affectedRows ?? 0);
}

/**
 * Drain PENDING outbox → create notification as REGISTRADA.
 * ENVIADA_EXTERNA only when adapter reports external success.
 */
export async function processOutboxOnce(
  db: any,
  opts: {
    limit?: number;
    adapter?: DeliveryAdapter;
    actorUserId?: number;
    workerId?: string;
    leaseMinutes?: number;
  } = {},
) {
  const adapter = opts.adapter ?? logAdapter;
  const limit = opts.limit ?? 50;
  const workerId = opts.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
  const leaseMinutes = opts.leaseMinutes ?? DEFAULT_LEASE_MINUTES;

  await reclaimStaleOutboxClaims(db, leaseMinutes);

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
      .set({
        status: "PROCESSING",
        attempts: Number(row.attempts) + 1,
        claimedAt: new Date(),
        claimedBy: workerId,
      } as any)
      .where(and(eq(domainOutbox.id, row.id), eq(domainOutbox.status, "PENDING")));
    const affected = Number(claimed?.[0]?.affectedRows ?? 0);
    if (affected === 0) continue;

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
      const preferredActor =
        payload.actorUserId != null ? Number(payload.actorUserId) : opts.actorUserId ?? null;
      const actorResolved = await resolveSystemActorUserId(db, row.tenantId, preferredActor);
      if (actorResolved === SYSTEM_ACTOR_SENTINEL) {
        // Fail-closed for legal-effect events: never mark SENT without a real system actor.
        const legal = efectoLegalFromEventType(row.eventType);
        console.error("[outbox] system actor missing — fail-closed", {
          tenantId: row.tenantId,
          eventType: row.eventType,
          legal,
          hint: `ensureSystemActor → ${systemActorEmail(row.tenantId)}`,
        });
        await db
          .update(domainOutbox)
          .set({
            status: legal ? "FAILED" : "PENDING",
            processedAt: legal ? new Date() : null,
            claimedAt: null,
            claimedBy: null,
            lastError: `no_system_actor:${systemActorEmail(row.tenantId)}`,
            nextAttemptAt: legal ? new Date() : new Date(Date.now() + 5 * 60_000),
          } as any)
          .where(eq(domainOutbox.id, row.id));
        // Do not count as successful process for legal events
        if (!legal) processed += 1;
        continue;
      }
      const actorUserId = actorResolved;

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
      let providerMessageId: string | null = null;
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
          outboxId: row.id,
        });
        const prevAttempts = Array.isArray(row.deliveryAttempts) ? row.deliveryAttempts : (typeof row.deliveryAttempts === "string" ? JSON.parse(row.deliveryAttempts || "[]") : []);
        const attemptLog = [
          ...prevAttempts,
          {
            at: new Date().toISOString(),
            adapter: adapter.name,
            ok: result.ok,
            external: result.external,
            messageId: result.messageId ?? null,
            to: email,
          },
        ];
        if (result.ok && result.external) {
          externalOk = true;
          providerMessageId = result.messageId ?? null;
          await db
            .update(notificaciones)
            .set({ estado: "ENVIADA_EXTERNA", enviadaAt: new Date() } as any)
            .where(eq(notificaciones.id, notifId));
          await db
            .update(notificacionDestinatarios)
            .set({ deliveryStatus: "ENVIADO" } as any)
            .where(eq(notificacionDestinatarios.notificacionId, notifId));
        }
        await db
          .update(domainOutbox)
          .set({ deliveryAttempts: attemptLog } as any)
          .where(eq(domainOutbox.id, row.id));
      }

      await db
        .update(domainOutbox)
        .set({
          status: "SENT",
          processedAt: new Date(),
          claimedAt: null,
          claimedBy: null,
          providerMessageId,
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
          claimedAt: null,
          claimedBy: null,
          lastError: String(e?.message ?? e),
          nextAttemptAt: new Date(Date.now() + backoffMin * 60_000),
        } as any)
        .where(eq(domainOutbox.id, row.id));
    }
  }
  return { processed, scanned: rows.length, workerId };
}
