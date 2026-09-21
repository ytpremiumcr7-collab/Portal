import { mysqlTable, mysqlEnum, serial, varchar, text, timestamp, bigint, int, boolean, index, uniqueIndex, foreignKey, json } from "drizzle-orm/mysql-core";
import { tenants, users, investigacionesMercado, proveedoresConsultados } from "./schema";

const tenantColumns = {
  tenantId: bigint("tenant_id", { mode: "number", unsigned: true }).notNull(),
};

export const marketInvitations = mysqlTable("market_invitations", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  investigacionId: bigint("investigacion_id", { mode: "number", unsigned: true }).notNull(),
  proveedorConsultadoId: bigint("proveedor_consultado_id", { mode: "number", unsigned: true }).notNull(),
  proveedorId: bigint("proveedor_id", { mode: "number", unsigned: true }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  estado: mysqlEnum("estado_inv_merc", ["EMITIDA", "ACEPTADA", "RESPONDIDA", "VENCIDA", "REVOCADA"]).default("EMITIDA").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  respondidaAt: timestamp("respondida_at"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("mkt_inv_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("mkt_inv_token_uq").on(t.tokenHash),
  index("mkt_inv_inv_idx").on(t.tenantId, t.investigacionId),
  foreignKey({ name: "mkt_inv_tenant_fk", columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
]);

export const fuentesMercado = mysqlTable("fuentes_mercado", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  investigacionId: bigint("investigacion_id", { mode: "number", unsigned: true }).notNull(),
  tipo: mysqlEnum("tipo_fuente_merc", [
    "PLATAFORMA_HISTORICA", "CAMARA_ORGANISMO", "CONSULTA_WEB", "OFICIO",
    "SOLICITUD_INFORMATIVA", "TABULADOR_RAMO", "PRESUPUESTO_BASE",
  ]).notNull(),
  descripcion: text("descripcion").notNull(),
  consultadaAt: timestamp("consultada_at").notNull(),
  documentoId: bigint("documento_id", { mode: "number", unsigned: true }).notNull(),
  urlOReferencia: varchar("url_o_referencia", { length: 400 }),
  precioObservado: varchar("precio_observado", { length: 20 }),
  comparable: boolean("comparable").default(true).notNull(),
  notasComparabilidad: text("notas_comparabilidad"),
  registradaPor: bigint("registrada_por", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("fuente_merc_tenant_id_uq").on(t.tenantId, t.id),
  index("fuente_merc_inv_idx").on(t.tenantId, t.investigacionId),
  foreignKey({ name: "fuente_merc_tenant_fk", columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
]);

export const legalHolds = mysqlTable("legal_holds", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  holdCode: varchar("hold_code", { length: 100 }).notNull(),
  reason: text("reason").notNull(),
  authorityRef: varchar("authority_ref", { length: 200 }),
  startsAt: timestamp("starts_at").notNull(),
  releasedAt: timestamp("released_at"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }).notNull(),
  releasedBy: bigint("released_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("legal_hold_code_uq").on(t.tenantId, t.holdCode),
  foreignKey({ name: "legal_hold_tenant_fk", columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
]);

export const legalHoldTargets = mysqlTable("legal_hold_targets", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  legalHoldId: bigint("legal_hold_id", { mode: "number", unsigned: true }).notNull(),
  targetType: varchar("target_type", { length: 80 }).notNull(),
  targetId: varchar("target_id", { length: 100 }).notNull(),
}, (t) => [
  uniqueIndex("legal_hold_tgt_uq").on(t.legalHoldId, t.targetType, t.targetId),
  index("legal_hold_tgt_lookup").on(t.tenantId, t.targetType, t.targetId),
  foreignKey({ name: "legal_hold_tgt_hold_fk", columns: [t.legalHoldId], foreignColumns: [legalHolds.id] }).onDelete("restrict"),
]);

export const evidenceAnchors = mysqlTable("evidence_anchors", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  expedienteId: bigint("expediente_id", { mode: "number", unsigned: true }),
  eventSequence: int("event_sequence"),
  eventHash: varchar("event_hash", { length: 64 }).notNull(),
  algorithm: varchar("algorithm", { length: 40 }).default("SHA256").notNull(),
  status: mysqlEnum("anchor_status", ["PENDING_EXTERNAL", "ANCHORED", "FAILED"]).default("PENDING_EXTERNAL").notNull(),
  tsaUrl: varchar("tsa_url", { length: 300 }),
  token: text("token"),
  anchoredAt: timestamp("anchored_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("ev_anchor_hash_idx").on(t.tenantId, t.eventHash),
]);

export const backupRestoreDrills = mysqlTable("backup_restore_drills", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number", unsigned: true }),
  drillCode: varchar("drill_code", { length: 80 }).notNull(),
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at"),
  status: mysqlEnum("drill_status", ["RUNNING", "PASSED", "FAILED"]).default("RUNNING").notNull(),
  eventsChecked: int("events_checked").default(0).notNull(),
  documentsChecked: int("documents_checked").default(0).notNull(),
  mismatches: int("mismatches").default(0).notNull(),
  report: json("report"),
  actorUserId: bigint("actor_user_id", { mode: "number", unsigned: true }),
}, (t) => [
  uniqueIndex("backup_drill_code_uq").on(t.drillCode),
]);

void investigacionesMercado;
void proveedoresConsultados;
void users;
void marketInvitations;
