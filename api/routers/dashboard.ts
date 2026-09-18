import { eq, count, sql, and, desc } from "drizzle-orm";
import { createRouter, authedQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  licitaciones,
  proveedores,
  participaciones,
  alertasSeguridad,
  entidades,
  categorias,
} from "@db/schema";

export const dashboardRouter = createRouter({
  metrics: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [activas, adjudicadas, monto, prov, ofertas, alertas] = await Promise.all([
      db
        .select({ count: count() })
        .from(licitaciones)
        .where(and(eq(licitaciones.tenantId, ctx.user.tenantId), eq(licitaciones.estado, "PUBLICADA"))),
      db
        .select({ count: count() })
        .from(licitaciones)
        .where(and(eq(licitaciones.tenantId, ctx.user.tenantId), eq(licitaciones.estado, "ADJUDICADA"))),
      db
        .select({ total: sql<string>`COALESCE(SUM(${licitaciones.montoAdjudicado}),0)` })
        .from(licitaciones)
        .where(and(eq(licitaciones.tenantId, ctx.user.tenantId), eq(licitaciones.estado, "ADJUDICADA"))),
      db
        .select({ count: count() })
        .from(proveedores)
        .where(
          and(eq(proveedores.tenantId, ctx.user.tenantId), eq(proveedores.estadoVerificacion, "VERIFICADO")),
        ),
      db.select({ count: count() }).from(participaciones).where(eq(participaciones.tenantId, ctx.user.tenantId)),
      db
        .select({ count: count() })
        .from(alertasSeguridad)
        .where(
          and(
            eq(alertasSeguridad.tenantId, ctx.user.tenantId),
            eq(alertasSeguridad.estado, "NUEVA"),
            sql`${alertasSeguridad.severidad} IN ('ALTA','CRITICA')`,
          ),
        ),
    ]);
    return {
      licitacionesActivas: Number(activas[0]?.count ?? 0),
      licitacionesAdjudicadasPeriodo: Number(adjudicadas[0]?.count ?? 0),
      montoTotalAdjudicadoPeriodo: Number(monto[0]?.total ?? 0),
      proveedoresActivos: Number(prov[0]?.count ?? 0),
      ofertasRecibidasPeriodo: Number(ofertas[0]?.count ?? 0),
      alertasUrgentes: Number(alertas[0]?.count ?? 0),
    };
  }),

  recentLicitaciones: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const where =
      ctx.user.role === "proveedor"
        ? and(eq(licitaciones.tenantId, ctx.user.tenantId), eq(licitaciones.estado, "PUBLICADA"))
        : eq(licitaciones.tenantId, ctx.user.tenantId);

    const rows = await db
      .select({
        id: licitaciones.id,
        codigo: licitaciones.codigo,
        titulo: licitaciones.titulo,
        estado: licitaciones.estado,
        montoPresupuestado: licitaciones.montoPresupuestado,
        createdAt: licitaciones.createdAt,
        entidadRazonSocial: entidades.razonSocial,
        categoriaNombre: categorias.nombre,
      })
      .from(licitaciones)
      .leftJoin(
        entidades,
        and(eq(entidades.id, licitaciones.entidadId), eq(entidades.tenantId, licitaciones.tenantId)),
      )
      .leftJoin(
        categorias,
        and(eq(categorias.id, licitaciones.categoriaId), eq(categorias.tenantId, licitaciones.tenantId)),
      )
      .where(where)
      .orderBy(desc(licitaciones.createdAt))
      .limit(5);

    return rows.map((r) => ({
      id: r.id,
      codigo: r.codigo,
      titulo: r.titulo,
      estado: r.estado,
      montoPresupuestado: r.montoPresupuestado,
      createdAt: r.createdAt,
      entidad: r.entidadRazonSocial ? { razonSocial: r.entidadRazonSocial } : null,
      categoria: r.categoriaNombre ? { nombre: r.categoriaNombre } : null,
    }));
  }),

  recentAlertas: authedQuery.query(async ({ ctx }) => {
    if (ctx.user.role === "proveedor") return [];
    const db = getDb();
    const rows = await db
      .select({
        id: alertasSeguridad.id,
        codigo: alertasSeguridad.codigo,
        severidad: alertasSeguridad.severidad,
        descripcion: alertasSeguridad.descripcion,
        estado: alertasSeguridad.estado,
        creadaEn: alertasSeguridad.creadaEn,
        licitacionCodigo: licitaciones.codigo,
        proveedorRazon: proveedores.razonSocial,
      })
      .from(alertasSeguridad)
      .leftJoin(
        licitaciones,
        and(
          eq(licitaciones.id, alertasSeguridad.licitacionId),
          eq(licitaciones.tenantId, alertasSeguridad.tenantId),
        ),
      )
      .leftJoin(
        proveedores,
        and(
          eq(proveedores.id, alertasSeguridad.proveedorId),
          eq(proveedores.tenantId, alertasSeguridad.tenantId),
        ),
      )
      .where(eq(alertasSeguridad.tenantId, ctx.user.tenantId))
      .orderBy(desc(alertasSeguridad.creadaEn))
      .limit(5);

    return rows.map((r) => ({
      id: r.id,
      codigo: r.codigo,
      severidad: r.severidad,
      descripcion: r.descripcion,
      estado: r.estado,
      creadaEn: r.creadaEn,
      licitacion: r.licitacionCodigo ? { codigo: r.licitacionCodigo } : null,
      proveedor: r.proveedorRazon ? { razonSocial: r.proveedorRazon } : null,
    }));
  }),
});
