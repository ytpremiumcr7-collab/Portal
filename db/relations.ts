import { relations } from "drizzle-orm";
import {
  tenants, users, sessions, entidades, proveedores, categorias, licitaciones,
  expedientes, expedienteRequirements, expedienteEvents, participaciones,
  alertasSeguridad, documentos, hitos, auditLog,
  aclaracionesJuntas, aclaracionesPreguntas, aclaracionesRespuestas,
  aperturas, aperturaRegistros, dictamenes, dictamenFirmantes, fallos,
  contratos, garantias,
} from "./schema";

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  sessions: many(sessions),
  entidades: many(entidades),
  proveedores: many(proveedores),
  categorias: many(categorias),
  licitaciones: many(licitaciones),
  expedientes: many(expedientes),
  participaciones: many(participaciones),
  alertas: many(alertasSeguridad),
  documentos: many(documentos),
  hitos: many(hitos),
  auditLog: many(auditLog),
  aclaracionesJuntas: many(aclaracionesJuntas),
  aperturas: many(aperturas),
  dictamenes: many(dictamenes),
  fallos: many(fallos),
  contratos: many(contratos),
  garantias: many(garantias),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  sessions: many(sessions),
  convocatorias: many(licitaciones),
  evaluaciones: many(participaciones),
  documentos: many(documentos),
  auditLog: many(auditLog),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  tenant: one(tenants, { fields: [sessions.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const entidadesRelations = relations(entidades, ({ one, many }) => ({
  tenant: one(tenants, { fields: [entidades.tenantId], references: [tenants.id] }),
  licitaciones: many(licitaciones),
}));

export const proveedoresRelations = relations(proveedores, ({ one, many }) => ({
  tenant: one(tenants, { fields: [proveedores.tenantId], references: [tenants.id] }),
  participaciones: many(participaciones),
  alertas: many(alertasSeguridad),
  documentos: many(documentos),
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
  participaciones: many(participaciones),
  alertas: many(alertasSeguridad),
  documentos: many(documentos),
  hitos: many(hitos),
  juntaAclaraciones: one(aclaracionesJuntas),
  apertura: one(aperturas),
  dictamenes: many(dictamenes),
  fallo: one(fallos),
  contrato: one(contratos),
}));

export const expedientesRelations = relations(expedientes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [expedientes.tenantId], references: [tenants.id] }),
  licitacion: one(licitaciones, { fields: [expedientes.licitacionId], references: [licitaciones.id] }),
  requirements: many(expedienteRequirements),
  events: many(expedienteEvents),
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
  garantias: many(garantias),
}));

export const garantiasRelations = relations(garantias, ({ one }) => ({
  tenant: one(tenants, { fields: [garantias.tenantId], references: [tenants.id] }),
  contrato: one(contratos, { fields: [garantias.contratoId], references: [contratos.id] }),
  proveedor: one(proveedores, { fields: [garantias.proveedorId], references: [proveedores.id] }),
}));
