import { getDb } from "../queries/connection";
import { notificaciones, notificacionDestinatarios, proveedores } from "@db/schema";
import { and, eq } from "drizzle-orm";

/** Best-effort official notification hook (no throw on failure). */
export async function tryNotifyEvent(input: {
  tenantId: number;
  actorUserId: number;
  codigoEvento: string;
  asunto: string;
  cuerpo: string;
  entidadRef?: string;
  entidadId?: number;
  licitacionId?: number;
  proveedorId?: number;
}) {
  try {
    const db = getDb();
    let email: string | null = null;
    if (input.proveedorId) {
      const prov = await db.query.proveedores.findFirst({
        where: and(eq(proveedores.id, input.proveedorId), eq(proveedores.tenantId, input.tenantId)),
      });
      email = (prov as any)?.email ?? null;
    }
    if (!email) return { sent: false as const };
    const result = await db.insert(notificaciones).values({
      tenantId: input.tenantId,
      templateId: null,
      codigoEvento: input.codigoEvento as any,
      asunto: input.asunto,
      cuerpo: input.cuerpo,
      efectoLegal: true,
      entidadRef: input.entidadRef ?? null,
      entidadId: input.entidadId ?? null,
      licitacionId: input.licitacionId ?? null,
      estado: "ENVIADA",
      creadaPor: input.actorUserId,
      enviadaAt: new Date(),
    } as any);
    const id = Number(result[0].insertId);
    await db.insert(notificacionDestinatarios).values({
      tenantId: input.tenantId,
      notificacionId: id,
      email,
      proveedorId: input.proveedorId ?? null,
      deliveryStatus: "ENVIADO",
    } as any);
    return { sent: true as const, id };
  } catch {
    return { sent: false as const };
  }
}
