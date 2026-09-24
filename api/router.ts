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
import { planeacionRouter } from "./routers/planeacion";
import { investigacionMercadoRouter } from "./routers/investigacionMercado";
import { procedimientoRouter } from "./routers/procedimiento";
import { ejecucionRouter } from "./routers/ejecucion";
import { pagosRouter } from "./routers/pagos";
import { incidenciasRouter } from "./routers/incidencias";
import { sancionesRouter } from "./routers/sanciones";
import { inconformidadesRouter } from "./routers/inconformidades";
import { notificacionesRouter } from "./routers/notificaciones";
import { consultaPublicaRouter } from "./routers/consultaPublica";
import { capabilitiesRouter } from "./routers/capabilities";
import { sodRouter } from "./routers/sod";
import { actoAdjudicacionRouter } from "./routers/actoAdjudicacion";
import { comisionRouter } from "./routers/comision";
import { terminacionRouter } from "./routers/terminacion";
import { calendarioRouter } from "./routers/calendario";
import { consorciosRouter } from "./routers/consorcios";
import { cucopRouter } from "./routers/cucop";
import { desempateRouter } from "./routers/desempate";
import { smtpRouter } from "./routers/smtp";
import { firmasRouter } from "./routers/firmas";
import { dialogoRouter } from "./routers/dialogo";
import { continuidadRouter, legalHoldRouter } from "./routers/continuidad";
import { institutionalRouter } from "./routers/institutional";
import { workRouter } from "./routers/work";

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
  planeacion: planeacionRouter,
  investigacionMercado: investigacionMercadoRouter,
  procedimiento: procedimientoRouter,
  ejecucion: ejecucionRouter,
  pagos: pagosRouter,
  incidencias: incidenciasRouter,
  sanciones: sancionesRouter,
  inconformidades: inconformidadesRouter,
  notificaciones: notificacionesRouter,
  consultaPublica: consultaPublicaRouter,
  capabilities: capabilitiesRouter,
  sod: sodRouter,
  actoAdjudicacion: actoAdjudicacionRouter,
  comision: comisionRouter,
  terminacion: terminacionRouter,
  calendario: calendarioRouter,
  consorcios: consorciosRouter,
  cucop: cucopRouter,
  desempate: desempateRouter,
  smtp: smtpRouter,
  firmas: firmasRouter,
  dialogo: dialogoRouter,
  continuidad: continuidadRouter,
  legalHold: legalHoldRouter,
  institutional: institutionalRouter,
  work: workRouter,
});

export type AppRouter = typeof appRouter;
