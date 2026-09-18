import { relations } from "drizzle-orm";
import {
  tenants, users, sessions, entidades, proveedores, categorias, licitaciones,
  expedientes, expedienteRequirements, expedienteEvents, participaciones,
  alertasSeguridad, documentos, hitos, auditLog,
  aclaracionesJuntas, aclaracionesPreguntas, aclaracionesRespuestas,
  aperturas, aperturaRegistros, dictamenes, dictamenFirmantes, fallos,
  contratos, garantias,
  userCapabilities, programasAnuales, partidasPresupuestarias, necesidades,
  suficienciasPresupuestarias, estrategiasProcedimiento,
  investigacionesMercado, proveedoresConsultados, cotizacionesMercado,
  procedimientoEventos, procedimientoPlazos,
  modificacionesContractuales, ejecucionesContractuales, entregables, finiquitos,
  estimacionesPago, incidencias, investigacionesSancion, sanciones, proveedoresImpedidos,
  inconformidades, notificacionTemplates, notificaciones, notificacionDestinatarios,
} from "./schema";

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users), sessions: many(sessions), entidades: many(entidades),
  proveedores: many(proveedores), categorias: many(categorias), licitaciones: many(licitaciones),
  expedientes: many(expedientes), participaciones: many(participaciones),
  alertas: many(alertasSeguridad), documentos: many(documentos), hitos: many(hitos),
  auditLog: many(auditLog), aclaracionesJuntas: many(aclaracionesJuntas),
  aperturas: many(aperturas), dictamenes: many(dictamenes), fallos: many(fallos),
  contratos: many(contratos), garantias: many(garantias),
  programasAnuales: many(programasAnuales), necesidades: many(necesidades),
  investigacionesMercado: many(investigacionesMercado), sanciones: many(sanciones),
  notificaciones: many(notificaciones),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  sessions: many(sessions), convocatorias: many(licitaciones),
  evaluaciones: many(participaciones), documentos: many(documentos),
  auditLog: many(auditLog), capabilities: many(userCapabilities),
}));

export const userCapabilitiesRelations = relations(userCapabilities, ({ one }) => ({
  user: one(users, { fields: [userCapabilities.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [userCapabilities.tenantId], references: [tenants.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  tenant: one(tenants, { fields: [sessions.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const entidadesRelations = relations(entidades, ({ one, many }) => ({
  tenant: one(tenants, { fields: [entidades.tenantId], references: [tenants.id] }),
  licitaciones: many(licitaciones), programas: many(programasAnuales), necesidades: many(necesidades),
}));

export const proveedoresRelations = relations(proveedores, ({ one, many }) => ({
  tenant: one(tenants, { fields: [proveedores.tenantId], references: [tenants.id] }),
  participaciones: many(participaciones), alertas: many(alertasSeguridad),
  documentos: many(documentos), sanciones: many(sanciones), impedimentos: many(proveedoresImpedidos),
}));

export const categoriasRelations = relations(categorias, ({ one, many }) => ({
  tenant: one(tenants, { fields: [categorias.tenantId], references: [tenants.id] }),
  licitaciones: many(licitaciones),
}));

export const licitacionesRelations = relations(licitaciones, ({ one, many }) => ({
  tenant: one(tenants, { fields: [licitaciones.tenantId], references: [tenants.id] }),
  entidad: one(entidades, { fields: [licitaciones.entidadId], references: [entidades.id] }),
  categoria: one(categorias, { fields: [licitaciones.categoriaId], references: [categorias.id] }),
  convocante: one(users, { fields: [licitaciones.convocanteId], references: [users.id] }),
  proveedorGanador: one(proveedores, { fields: [licitaciones.proveedorGanadorId], references: [proveedores.id] }),
  participaciones: many(participaciones), alertas: many(alertasSeguridad),
  documentos: many(documentos), hitos: many(hitos),
  juntaAclaraciones: one(aclaracionesJuntas), apertura: one(aperturas),
  dictamenes: many(dictamenes), fallo: one(fallos), contrato: one(contratos),
  procedimientoEventos: many(procedimientoEventos), plazos: many(procedimientoPlazos),
  inconformidades: many(inconformidades),
}));

export const expedientesRelations = relations(expedientes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [expedientes.tenantId], references: [tenants.id] }),
  licitacion: one(licitaciones, { fields: [expedientes.licitacionId], references: [licitaciones.id] }),
  requirements: many(expedienteRequirements), events: many(expedienteEvents),
}));

export const expedienteRequirementsRelations = relations(expedienteRequirements, ({ one }) => ({
  tenant: one(tenants, { fields: [expedienteRequirements.tenantId], references: [tenants.id] }),
  expediente: one(expedientes, { fields: [expedienteRequirements.expedienteId], references: [expedientes.id] }),
  validator: one(users, { fields: [expedienteRequirements.validadoPor], references: [users.id] }),
}));

export const expedienteEventsRelations = relations(expedienteEvents, ({ one }) => ({
  tenant: one(tenants, { fields: [expedienteEvents.tenantId], references: [tenants.id] }),
  expediente: one(expedientes, { fields: [expedienteEvents.expedienteId], references: [expedientes.id] }),
  actor: one(users, { fields: [expedienteEvents.actorUserId], references: [users.id] }),
}));

export const participacionesRelations = relations(participaciones, ({ one }) => ({
  tenant: one(tenants, { fields: [participaciones.tenantId], references: [tenants.id] }),
  licitacion: one(licitaciones, { fields: [participaciones.licitacionId], references: [licitaciones.id] }),
  proveedor: one(proveedores, { fields: [participaciones.proveedorId], references: [proveedores.id] }),
  evaluator: one(users, { fields: [participaciones.evaluatedBy], references: [users.id] }),
}));

export const alertasRelations = relations(alertasSeguridad, ({ one }) => ({
  tenant: one(tenants, { fields: [alertasSeguridad.tenantId], references: [tenants.id] }),
  licitacion: one(licitaciones, { fields: [alertasSeguridad.licitacionId], references: [licitaciones.id] }),
  proveedor: one(proveedores, { fields: [alertasSeguridad.proveedorId], references: [proveedores.id] }),
}));

export const documentosRelations = relations(documentos, ({ one }) => ({
  tenant: one(tenants, { fields: [documentos.tenantId], references: [tenants.id] }),
  expediente: one(expedientes, { fields: [documentos.expedienteId], references: [expedientes.id] }),
  licitacion: one(licitaciones, { fields: [documentos.licitacionId], references: [licitaciones.id] }),
  proveedor: one(proveedores, { fields: [documentos.proveedorId], references: [proveedores.id] }),
  usuario: one(users, { fields: [documentos.subidoPor], references: [users.id] }),
}));

export const hitosRelations = relations(hitos, ({ one }) => ({
  tenant: one(tenants, { fields: [hitos.tenantId], references: [tenants.id] }),
  expediente: one(expedientes, { fields: [hitos.expedienteId], references: [expedientes.id] }),
  licitacion: one(licitaciones, { fields: [hitos.licitacionId], references: [licitaciones.id] }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  tenant: one(tenants, { fields: [auditLog.tenantId], references: [tenants.id] }),
  actor: one(users, { fields: [auditLog.actorUserId], references: [users.id] }),
}));

export const aclaracionesJuntasRelations = relations(aclaracionesJuntas, ({ one, many }) => ({
  tenant: one(tenants, { fields: [aclaracionesJuntas.tenantId], references: [tenants.id] }),
  licitacion: one(licitaciones, { fields: [aclaracionesJuntas.licitacionId], references: [licitaciones.id] }),
  expediente: one(expedientes, { fields: [aclaracionesJuntas.expedienteId], references: [expedientes.id] }),
  preguntas: many(aclaracionesPreguntas),
}));

export const aclaracionesPreguntasRelations = relations(aclaracionesPreguntas, ({ one }) => ({
  junta: one(aclaracionesJuntas, { fields: [aclaracionesPreguntas.juntaId], references: [aclaracionesJuntas.id] }),
  proveedor: one(proveedores, { fields: [aclaracionesPreguntas.proveedorId], references: [proveedores.id] }),
  respuesta: one(aclaracionesRespuestas),
}));

export const aclaracionesRespuestasRelations = relations(aclaracionesRespuestas, ({ one }) => ({
  pregunta: one(aclaracionesPreguntas, { fields: [aclaracionesRespuestas.preguntaId], references: [aclaracionesPreguntas.id] }),
  junta: one(aclaracionesJuntas, { fields: [aclaracionesRespuestas.juntaId], references: [aclaracionesJuntas.id] }),
}));

export const aperturasRelations = relations(aperturas, ({ one, many }) => ({
  tenant: one(tenants, { fields: [aperturas.tenantId], references: [tenants.id] }),
  licitacion: one(licitaciones, { fields: [aperturas.licitacionId], references: [licitaciones.id] }),
  expediente: one(expedientes, { fields: [aperturas.expedienteId], references: [expedientes.id] }),
  registros: many(aperturaRegistros),
}));

export const aperturaRegistrosRelations = relations(aperturaRegistros, ({ one }) => ({
  apertura: one(aperturas, { fields: [aperturaRegistros.aperturaId], references: [aperturas.id] }),
  participacion: one(participaciones, { fields: [aperturaRegistros.participacionId], references: [participaciones.id] }),
  proveedor: one(proveedores, { fields: [aperturaRegistros.proveedorId], references: [proveedores.id] }),
}));

export const dictamenesRelations = relations(dictamenes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [dictamenes.tenantId], references: [tenants.id] }),
  licitacion: one(licitaciones, { fields: [dictamenes.licitacionId], references: [licitaciones.id] }),
  expediente: one(expedientes, { fields: [dictamenes.expedienteId], references: [expedientes.id] }),
  firmantes: many(dictamenFirmantes),
}));

export const dictamenFirmantesRelations = relations(dictamenFirmantes, ({ one }) => ({
  dictamen: one(dictamenes, { fields: [dictamenFirmantes.dictamenId], references: [dictamenes.id] }),
  usuario: one(users, { fields: [dictamenFirmantes.usuarioId], references: [users.id] }),
}));

export const fallosRelations = relations(fallos, ({ one }) => ({
  tenant: one(tenants, { fields: [fallos.tenantId], references: [tenants.id] }),
  licitacion: one(licitaciones, { fields: [fallos.licitacionId], references: [licitaciones.id] }),
  expediente: one(expedientes, { fields: [fallos.expedienteId], references: [expedientes.id] }),
  dictamen: one(dictamenes, { fields: [fallos.dictamenId], references: [dictamenes.id] }),
}));

export const contratosRelations = relations(contratos, ({ one, many }) => ({
  tenant: one(tenants, { fields: [contratos.tenantId], references: [tenants.id] }),
  licitacion: one(licitaciones, { fields: [contratos.licitacionId], references: [licitaciones.id] }),
  expediente: one(expedientes, { fields: [contratos.expedienteId], references: [expedientes.id] }),
  fallo: one(fallos, { fields: [contratos.falloId], references: [fallos.id] }),
  proveedor: one(proveedores, { fields: [contratos.proveedorId], references: [proveedores.id] }),
  garantias: many(garantias), modificaciones: many(modificacionesContractuales),
  ejecucion: one(ejecucionesContractuales), estimaciones: many(estimacionesPago),
}));

export const garantiasRelations = relations(garantias, ({ one }) => ({
  tenant: one(tenants, { fields: [garantias.tenantId], references: [tenants.id] }),
  contrato: one(contratos, { fields: [garantias.contratoId], references: [contratos.id] }),
  proveedor: one(proveedores, { fields: [garantias.proveedorId], references: [proveedores.id] }),
}));

// Phase 3
export const programasAnualesRelations = relations(programasAnuales, ({ one, many }) => ({
  tenant: one(tenants, { fields: [programasAnuales.tenantId], references: [tenants.id] }),
  entidad: one(entidades, { fields: [programasAnuales.entidadId], references: [entidades.id] }),
  partidas: many(partidasPresupuestarias),
}));

export const partidasPresupuestariasRelations = relations(partidasPresupuestarias, ({ one }) => ({
  programa: one(programasAnuales, { fields: [partidasPresupuestarias.programaId], references: [programasAnuales.id] }),
}));

export const necesidadesRelations = relations(necesidades, ({ one, many }) => ({
  tenant: one(tenants, { fields: [necesidades.tenantId], references: [tenants.id] }),
  entidad: one(entidades, { fields: [necesidades.entidadId], references: [entidades.id] }),
  partida: one(partidasPresupuestarias, { fields: [necesidades.partidaId], references: [partidasPresupuestarias.id] }),
  suficiencias: many(suficienciasPresupuestarias),
  estrategia: one(estrategiasProcedimiento),
}));

export const suficienciasPresupuestariasRelations = relations(suficienciasPresupuestarias, ({ one }) => ({
  necesidad: one(necesidades, { fields: [suficienciasPresupuestarias.necesidadId], references: [necesidades.id] }),
  partida: one(partidasPresupuestarias, { fields: [suficienciasPresupuestarias.partidaId], references: [partidasPresupuestarias.id] }),
}));

export const estrategiasProcedimientoRelations = relations(estrategiasProcedimiento, ({ one }) => ({
  necesidad: one(necesidades, { fields: [estrategiasProcedimiento.necesidadId], references: [necesidades.id] }),
  licitacion: one(licitaciones, { fields: [estrategiasProcedimiento.licitacionId], references: [licitaciones.id] }),
}));

export const investigacionesMercadoRelations = relations(investigacionesMercado, ({ one, many }) => ({
  tenant: one(tenants, { fields: [investigacionesMercado.tenantId], references: [tenants.id] }),
  consultados: many(proveedoresConsultados),
  cotizaciones: many(cotizacionesMercado),
}));

export const proveedoresConsultadosRelations = relations(proveedoresConsultados, ({ one, many }) => ({
  investigacion: one(investigacionesMercado, { fields: [proveedoresConsultados.investigacionId], references: [investigacionesMercado.id] }),
  cotizaciones: many(cotizacionesMercado),
}));

export const cotizacionesMercadoRelations = relations(cotizacionesMercado, ({ one }) => ({
  investigacion: one(investigacionesMercado, { fields: [cotizacionesMercado.investigacionId], references: [investigacionesMercado.id] }),
  proveedorConsultado: one(proveedoresConsultados, { fields: [cotizacionesMercado.proveedorConsultadoId], references: [proveedoresConsultados.id] }),
}));

export const procedimientoEventosRelations = relations(procedimientoEventos, ({ one }) => ({
  licitacion: one(licitaciones, { fields: [procedimientoEventos.licitacionId], references: [licitaciones.id] }),
}));

export const procedimientoPlazosRelations = relations(procedimientoPlazos, ({ one }) => ({
  licitacion: one(licitaciones, { fields: [procedimientoPlazos.licitacionId], references: [licitaciones.id] }),
}));

export const modificacionesContractualesRelations = relations(modificacionesContractuales, ({ one }) => ({
  contrato: one(contratos, { fields: [modificacionesContractuales.contratoId], references: [contratos.id] }),
}));

export const ejecucionesContractualesRelations = relations(ejecucionesContractuales, ({ one, many }) => ({
  contrato: one(contratos, { fields: [ejecucionesContractuales.contratoId], references: [contratos.id] }),
  entregables: many(entregables),
}));

export const entregablesRelations = relations(entregables, ({ one }) => ({
  ejecucion: one(ejecucionesContractuales, { fields: [entregables.ejecucionId], references: [ejecucionesContractuales.id] }),
  contrato: one(contratos, { fields: [entregables.contratoId], references: [contratos.id] }),
}));

export const finiquitosRelations = relations(finiquitos, ({ one }) => ({
  contrato: one(contratos, { fields: [finiquitos.contratoId], references: [contratos.id] }),
  ejecucion: one(ejecucionesContractuales, { fields: [finiquitos.ejecucionId], references: [ejecucionesContractuales.id] }),
}));

export const estimacionesPagoRelations = relations(estimacionesPago, ({ one }) => ({
  contrato: one(contratos, { fields: [estimacionesPago.contratoId], references: [contratos.id] }),
}));

export const incidenciasRelations = relations(incidencias, ({ one }) => ({
  contrato: one(contratos, { fields: [incidencias.contratoId], references: [contratos.id] }),
  proveedor: one(proveedores, { fields: [incidencias.proveedorId], references: [proveedores.id] }),
}));

export const investigacionesSancionRelations = relations(investigacionesSancion, ({ one }) => ({
  proveedor: one(proveedores, { fields: [investigacionesSancion.proveedorId], references: [proveedores.id] }),
}));

export const sancionesRelations = relations(sanciones, ({ one, many }) => ({
  proveedor: one(proveedores, { fields: [sanciones.proveedorId], references: [proveedores.id] }),
  investigacion: one(investigacionesSancion, { fields: [sanciones.investigacionId], references: [investigacionesSancion.id] }),
  impedimentos: many(proveedoresImpedidos),
}));

export const proveedoresImpedidosRelations = relations(proveedoresImpedidos, ({ one }) => ({
  proveedor: one(proveedores, { fields: [proveedoresImpedidos.proveedorId], references: [proveedores.id] }),
  sancion: one(sanciones, { fields: [proveedoresImpedidos.sancionId], references: [sanciones.id] }),
}));

export const inconformidadesRelations = relations(inconformidades, ({ one }) => ({
  licitacion: one(licitaciones, { fields: [inconformidades.licitacionId], references: [licitaciones.id] }),
}));

export const notificacionTemplatesRelations = relations(notificacionTemplates, ({ one }) => ({
  tenant: one(tenants, { fields: [notificacionTemplates.tenantId], references: [tenants.id] }),
}));

export const notificacionesRelations = relations(notificaciones, ({ one, many }) => ({
  tenant: one(tenants, { fields: [notificaciones.tenantId], references: [tenants.id] }),
  template: one(notificacionTemplates, { fields: [notificaciones.templateId], references: [notificacionTemplates.id] }),
  destinatarios: many(notificacionDestinatarios),
}));

export const notificacionDestinatariosRelations = relations(notificacionDestinatarios, ({ one }) => ({
  notificacion: one(notificaciones, { fields: [notificacionDestinatarios.notificacionId], references: [notificaciones.id] }),
}));
