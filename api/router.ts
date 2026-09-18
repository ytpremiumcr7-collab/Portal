import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { entidadesRouter } from "./routers/entidades";
import { proveedoresRouter } from "./routers/proveedores";
import { categoriasRouter } from "./routers/categorias";
import { licitacionesRouter } from "./routers/licitaciones";
import { participacionesRouter } from "./routers/participaciones";
import { alertasRouter } from "./routers/alertas";
import { dashboardRouter } from "./routers/dashboard";
import { documentosRouter } from "./routers/documentos";
import { hitosRouter } from "./routers/hitos";
import { auditoriaRouter } from "./routers/auditoria";
import { expedientesRouter } from "./routers/expedientes";
import { aclaracionesRouter } from "./routers/aclaraciones";
import { aperturasRouter } from "./routers/aperturas";
import { dictamenesRouter } from "./routers/dictamenes";
import { fallosRouter } from "./routers/fallos";
import { contratosRouter } from "./routers/contratos";
import { garantiasRouter } from "./routers/garantias";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  entidades: entidadesRouter,
  proveedores: proveedoresRouter,
  categorias: categoriasRouter,
  licitaciones: licitacionesRouter,
  participaciones: participacionesRouter,
  alertas: alertasRouter,
  dashboard: dashboardRouter,
  documentos: documentosRouter,
  hitos: hitosRouter,
  auditoria: auditoriaRouter,
  expedientes: expedientesRouter,
  aclaraciones: aclaracionesRouter,
  aperturas: aperturasRouter,
  dictamenes: dictamenesRouter,
  fallos: fallosRouter,
  contratos: contratosRouter,
  garantias: garantiasRouter,
});

export type AppRouter = typeof appRouter;
