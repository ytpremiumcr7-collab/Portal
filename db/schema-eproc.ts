import {
  mysqlTable, mysqlEnum, serial, varchar, text, timestamp, bigint, int,
  boolean, index, uniqueIndex, foreignKey, json, decimal,
} from "drizzle-orm/mysql-core";
import {
  tenants, users, entidades, proveedores, supplierLegalEntities, licitaciones,
  participaciones, proposiciones, documentos, fallos,
} from "./schema";

const tenantColumns = {
  tenantId: bigint("tenant_id", { mode: "number", unsigned: true }).notNull(),
};

export const organizationalUnits = mysqlTable("organizational_units", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  entidadId: bigint("entidad_id", { mode: "number", unsigned: true }).notNull(),
  code: varchar("code", { length: 80 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  unitType: mysqlEnum("unit_type", [
    "UNIDAD_COMPRADORA", "AREA_REQUIRENTE", "JURIDICO",
    "PRESUPUESTO", "CONTRATO", "AUDITORIA",
  ]).notNull(),
  parentUnitId: bigint("parent_unit_id", { mode: "number", unsigned: true }),
  active: boolean("active").default(true).notNull(),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("org_unit_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("org_unit_code_uq").on(t.tenantId, t.entidadId, t.code),
  index("org_unit_entity_idx").on(t.tenantId, t.entidadId, t.active),
  foreignKey({ name: "org_unit_tenant_fk", columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("restrict"),
  foreignKey({ name: "org_unit_entity_fk", columns: [t.tenantId, t.entidadId], foreignColumns: [entidades.tenantId, entidades.id] }).onDelete("restrict"),
]);

export const organizationalUnitMemberships = mysqlTable("organizational_unit_memberships", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  unitId: bigint("unit_id", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  role: mysqlEnum("institutional_role", [
    "OPERADOR", "TECNICO", "JURIDICO", "PRESUPUESTO",
    "APROBADOR", "ADMIN_CONTRATO", "AUDITOR",
  ]).notNull(),
  active: boolean("active").default(true).notNull(),
  validFrom: timestamp("valid_from").defaultNow().notNull(),
  validUntil: timestamp("valid_until"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("org_membership_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("org_membership_uq").on(t.tenantId, t.unitId, t.userId, t.role),
  index("org_membership_user_idx").on(t.tenantId, t.userId, t.active),
  foreignKey({ name: "org_membership_unit_fk", columns: [t.tenantId, t.unitId], foreignColumns: [organizationalUnits.tenantId, organizationalUnits.id] }).onDelete("restrict"),
  foreignKey({ name: "org_membership_user_fk", columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }).onDelete("restrict"),
]);

export const authorityDelegations = mysqlTable("authority_delegations", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  unitId: bigint("unit_id", { mode: "number", unsigned: true }).notNull(),
  delegatorUserId: bigint("delegator_user_id", { mode: "number", unsigned: true }).notNull(),
  delegateeUserId: bigint("delegatee_user_id", { mode: "number", unsigned: true }).notNull(),
  role: mysqlEnum("delegated_role", [
    "OPERADOR", "TECNICO", "JURIDICO", "PRESUPUESTO",
    "APROBADOR", "ADMIN_CONTRATO", "AUDITOR",
  ]).notNull(),
  scope: json("scope"),
  reason: text("reason").notNull(),
  active: boolean("active").default(true).notNull(),
  validFrom: timestamp("valid_from").notNull(),
  validUntil: timestamp("valid_until").notNull(),
  revokedAt: timestamp("revoked_at"),
  revokedBy: bigint("revoked_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("authority_delegation_tenant_id_uq").on(t.tenantId, t.id),
  index("authority_delegatee_idx").on(t.tenantId, t.delegateeUserId, t.unitId, t.active),
  foreignKey({ name: "authority_delegation_unit_fk", columns: [t.tenantId, t.unitId], foreignColumns: [organizationalUnits.tenantId, organizationalUnits.id] }).onDelete("restrict"),
  foreignKey({ name: "authority_delegator_fk", columns: [t.tenantId, t.delegatorUserId], foreignColumns: [users.tenantId, users.id] }).onDelete("restrict"),
  foreignKey({ name: "authority_delegatee_fk", columns: [t.tenantId, t.delegateeUserId], foreignColumns: [users.tenantId, users.id] }).onDelete("restrict"),
]);

export const procedureTeamMembers = mysqlTable("procedure_team_members", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  licitacionId: bigint("licitacion_id", { mode: "number", unsigned: true }).notNull(),
  unitId: bigint("unit_id", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  institutionalRole: varchar("institutional_role", { length: 40 }).notNull(),
  procedureRole: varchar("procedure_role", { length: 64 }),
  authoritySource: mysqlEnum("authority_source", ["MEMBERSHIP", "DELEGATION", "MIGRATED_LEGACY"]).notNull(),
  authorityRefId: bigint("authority_ref_id", { mode: "number", unsigned: true }),
  authoritySnapshot: json("authority_snapshot").notNull(),
  capturedAt: timestamp("captured_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("proc_team_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("proc_team_role_uq").on(t.tenantId, t.licitacionId, t.userId, t.procedureRole),
  index("proc_team_lic_idx").on(t.tenantId, t.licitacionId),
  foreignKey({ name: "proc_team_lic_fk", columns: [t.tenantId, t.licitacionId], foreignColumns: [licitaciones.tenantId, licitaciones.id] }).onDelete("restrict"),
  foreignKey({ name: "proc_team_unit_fk", columns: [t.tenantId, t.unitId], foreignColumns: [organizationalUnits.tenantId, organizationalUnits.id] }).onDelete("restrict"),
  foreignKey({ name: "proc_team_user_fk", columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }).onDelete("restrict"),
]);

export const supplierMemberships = mysqlTable("supplier_memberships", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  proveedorId: bigint("proveedor_id", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  role: mysqlEnum("supplier_role", ["OWNER", "REPRESENTATIVE", "PREPARER", "SIGNER", "ADMIN"]).notNull(),
  active: boolean("active").default(true).notNull(),
  validFrom: timestamp("valid_from").defaultNow().notNull(),
  validUntil: timestamp("valid_until"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("supplier_membership_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("supplier_membership_uq").on(t.tenantId, t.proveedorId, t.userId, t.role),
  index("supplier_membership_user_idx").on(t.tenantId, t.userId, t.active),
  foreignKey({ name: "supplier_membership_provider_fk", columns: [t.tenantId, t.proveedorId], foreignColumns: [proveedores.tenantId, proveedores.id] }).onDelete("restrict"),
  foreignKey({ name: "supplier_membership_user_fk", columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }).onDelete("restrict"),
]);

export const supplierAuthorities = mysqlTable("supplier_authorities", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  proveedorId: bigint("proveedor_id", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  authorityType: mysqlEnum("authority_type", ["LEGAL_REPRESENTATIVE", "POWER_OF_ATTORNEY", "SIGNATURE", "PROCUREMENT"]).notNull(),
  scope: json("scope"),
  documentId: bigint("document_id", { mode: "number", unsigned: true }),
  active: boolean("active").default(true).notNull(),
  validFrom: timestamp("valid_from").defaultNow().notNull(),
  validUntil: timestamp("valid_until"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("supplier_authority_tenant_id_uq").on(t.tenantId, t.id),
  index("supplier_authority_user_idx").on(t.tenantId, t.proveedorId, t.userId, t.active),
  foreignKey({ name: "supplier_authority_provider_fk", columns: [t.tenantId, t.proveedorId], foreignColumns: [proveedores.tenantId, proveedores.id] }).onDelete("restrict"),
  foreignKey({ name: "supplier_authority_user_fk", columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }).onDelete("restrict"),
  foreignKey({ name: "supplier_authority_doc_fk", columns: [t.tenantId, t.documentId], foreignColumns: [documentos.tenantId, documentos.id] }).onDelete("restrict"),
]);

export const workflowTemplates = mysqlTable("workflow_templates", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  code: varchar("code", { length: 80 }).notNull(),
  version: int("version").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  active: boolean("active").default(true).notNull(),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("workflow_template_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("workflow_template_code_version_uq").on(t.tenantId, t.code, t.version),
]);

export const workflowTemplateSteps = mysqlTable("workflow_template_steps", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  templateId: bigint("template_id", { mode: "number", unsigned: true }).notNull(),
  sequence: int("sequence").notNull(),
  actionCode: varchar("action_code", { length: 80 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  requiredRole: varchar("required_role", { length: 40 }).notNull(),
  completionMode: mysqlEnum("completion_mode", ["EXECUTE", "REVIEW", "APPROVE", "SIGN"]).default("APPROVE").notNull(),
  dueHours: int("due_hours"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("workflow_step_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("workflow_step_sequence_uq").on(t.tenantId, t.templateId, t.sequence),
  uniqueIndex("workflow_step_action_uq").on(t.tenantId, t.templateId, t.actionCode),
  foreignKey({ name: "workflow_step_template_fk", columns: [t.tenantId, t.templateId], foreignColumns: [workflowTemplates.tenantId, workflowTemplates.id] }).onDelete("restrict"),
]);

export const workflowInstances = mysqlTable("workflow_instances", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  licitacionId: bigint("licitacion_id", { mode: "number", unsigned: true }).notNull(),
  templateId: bigint("template_id", { mode: "number", unsigned: true }).notNull(),
  templateVersion: int("template_version").notNull(),
  status: mysqlEnum("workflow_status", ["RUNNING", "COMPLETED", "CANCELLED"]).default("RUNNING").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (t) => [
  uniqueIndex("workflow_instance_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("workflow_instance_lic_uq").on(t.tenantId, t.licitacionId),
  index("workflow_instance_status_idx").on(t.tenantId, t.status),
  foreignKey({ name: "workflow_instance_lic_fk", columns: [t.tenantId, t.licitacionId], foreignColumns: [licitaciones.tenantId, licitaciones.id] }).onDelete("restrict"),
  foreignKey({ name: "workflow_instance_template_fk", columns: [t.tenantId, t.templateId], foreignColumns: [workflowTemplates.tenantId, workflowTemplates.id] }).onDelete("restrict"),
]);

export const workTasks = mysqlTable("work_tasks", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  workflowInstanceId: bigint("workflow_instance_id", { mode: "number", unsigned: true }).notNull(),
  licitacionId: bigint("licitacion_id", { mode: "number", unsigned: true }).notNull(),
  templateStepId: bigint("template_step_id", { mode: "number", unsigned: true }).notNull(),
  sequence: int("sequence").notNull(),
  actionCode: varchar("action_code", { length: 80 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  requiredRole: varchar("required_role", { length: 40 }).notNull(),
  completionMode: mysqlEnum("completion_mode", ["EXECUTE", "REVIEW", "APPROVE", "SIGN"]).notNull(),
  state: mysqlEnum("task_state", [
    "PENDIENTE", "EN_PROGRESO", "EN_REVISION", "APROBADA", "RECHAZADA",
    "DEVUELTA", "CANCELADA", "VENCIDA",
  ]).default("PENDIENTE").notNull(),
  assignedUnitId: bigint("assigned_unit_id", { mode: "number", unsigned: true }).notNull(),
  assignedUserId: bigint("assigned_user_id", { mode: "number", unsigned: true }),
  dueAt: timestamp("due_at"),
  claimedAt: timestamp("claimed_at"),
  completedAt: timestamp("completed_at"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("work_task_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("work_task_instance_sequence_uq").on(t.tenantId, t.workflowInstanceId, t.sequence),
  index("work_task_inbox_idx").on(t.tenantId, t.assignedUnitId, t.state, t.dueAt),
  foreignKey({ name: "work_task_instance_fk", columns: [t.tenantId, t.workflowInstanceId], foreignColumns: [workflowInstances.tenantId, workflowInstances.id] }).onDelete("restrict"),
  foreignKey({ name: "work_task_lic_fk", columns: [t.tenantId, t.licitacionId], foreignColumns: [licitaciones.tenantId, licitaciones.id] }).onDelete("restrict"),
  foreignKey({ name: "work_task_unit_fk", columns: [t.tenantId, t.assignedUnitId], foreignColumns: [organizationalUnits.tenantId, organizationalUnits.id] }).onDelete("restrict"),
  foreignKey({ name: "work_task_user_fk", columns: [t.tenantId, t.assignedUserId], foreignColumns: [users.tenantId, users.id] }).onDelete("restrict"),
]);

export const taskApprovals = mysqlTable("task_approvals", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  taskId: bigint("task_id", { mode: "number", unsigned: true }).notNull(),
  level: int("level").default(1).notNull(),
  approverUserId: bigint("approver_user_id", { mode: "number", unsigned: true }).notNull(),
  authoritySnapshot: json("authority_snapshot").notNull(),
  decision: mysqlEnum("decision", ["APPROVED", "REJECTED", "RETURNED"]).notNull(),
  reason: text("reason").notNull(),
  decidedAt: timestamp("decided_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("task_approval_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("task_approval_once_uq").on(t.tenantId, t.taskId, t.level, t.approverUserId),
  foreignKey({ name: "task_approval_task_fk", columns: [t.tenantId, t.taskId], foreignColumns: [workTasks.tenantId, workTasks.id] }).onDelete("restrict"),
  foreignKey({ name: "task_approval_user_fk", columns: [t.tenantId, t.approverUserId], foreignColumns: [users.tenantId, users.id] }).onDelete("restrict"),
]);

export const procedureLots = mysqlTable("procedure_lots", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  licitacionId: bigint("licitacion_id", { mode: "number", unsigned: true }).notNull(),
  code: varchar("code", { length: 80 }).notNull(),
  title: varchar("title", { length: 240 }).notNull(),
  description: text("description"),
  status: mysqlEnum("lot_status", ["DRAFT", "ACTIVE", "CANCELLED", "AWARDED", "CLOSED"]).default("DRAFT").notNull(),
  estimatedAmount: decimal("estimated_amount", { precision: 18, scale: 2 }),
  currency: mysqlEnum("lot_currency", ["MXN"]).default("MXN").notNull(),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("procedure_lot_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("procedure_lot_code_uq").on(t.tenantId, t.licitacionId, t.code),
  index("procedure_lot_lic_idx").on(t.tenantId, t.licitacionId, t.status),
  foreignKey({ name: "procedure_lot_lic_fk", columns: [t.tenantId, t.licitacionId], foreignColumns: [licitaciones.tenantId, licitaciones.id] }).onDelete("restrict"),
]);

export const procedureItems = mysqlTable("procedure_items", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  licitacionId: bigint("licitacion_id", { mode: "number", unsigned: true }).notNull(),
  lotId: bigint("lot_id", { mode: "number", unsigned: true }).notNull(),
  code: varchar("code", { length: 80 }).notNull(),
  description: text("description").notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 4 }).notNull(),
  unit: varchar("unit", { length: 80 }).notNull(),
  estimatedUnitPrice: decimal("estimated_unit_price", { precision: 18, scale: 2 }),
  classificationCode: varchar("classification_code", { length: 80 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("procedure_item_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("procedure_item_code_uq").on(t.tenantId, t.lotId, t.code),
  index("procedure_item_lot_idx").on(t.tenantId, t.lotId),
  foreignKey({ name: "procedure_item_lot_fk", columns: [t.tenantId, t.lotId], foreignColumns: [procedureLots.tenantId, procedureLots.id] }).onDelete("restrict"),
]);

export const awards = mysqlTable("awards", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  licitacionId: bigint("licitacion_id", { mode: "number", unsigned: true }).notNull(),
  lotId: bigint("lot_id", { mode: "number", unsigned: true }).notNull(),
  proveedorId: bigint("proveedor_id", { mode: "number", unsigned: true }).notNull(),
  falloId: bigint("fallo_id", { mode: "number", unsigned: true }),
  status: mysqlEnum("award_status", ["DRAFT", "APPROVED", "PUBLISHED", "CANCELLED"]).default("DRAFT").notNull(),
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
  currency: mysqlEnum("award_currency", ["MXN"]).default("MXN").notNull(),
  reason: text("reason").notNull(),
  decidedBy: bigint("decided_by", { mode: "number", unsigned: true }).notNull(),
  approvedBy: bigint("approved_by", { mode: "number", unsigned: true }),
  approvedAt: timestamp("approved_at"),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("award_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("award_lot_provider_uq").on(t.tenantId, t.lotId, t.proveedorId),
  index("award_lic_idx").on(t.tenantId, t.licitacionId, t.status),
  index("award_lot_idx").on(t.tenantId, t.lotId, t.status),
  foreignKey({ name: "award_lot_fk", columns: [t.tenantId, t.lotId], foreignColumns: [procedureLots.tenantId, procedureLots.id] }).onDelete("restrict"),
  foreignKey({ name: "award_provider_fk", columns: [t.tenantId, t.proveedorId], foreignColumns: [proveedores.tenantId, proveedores.id] }).onDelete("restrict"),
  foreignKey({ name: "award_fallo_fk", columns: [t.tenantId, t.falloId], foreignColumns: [fallos.tenantId, fallos.id] }).onDelete("restrict"),
  foreignKey({ name: "award_decider_fk", columns: [t.tenantId, t.decidedBy], foreignColumns: [users.tenantId, users.id] }).onDelete("restrict"),
  foreignKey({ name: "award_approver_fk", columns: [t.tenantId, t.approvedBy], foreignColumns: [users.tenantId, users.id] }).onDelete("restrict"),
]);

export const awardItems = mysqlTable("award_items", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  awardId: bigint("award_id", { mode: "number", unsigned: true }).notNull(),
  itemId: bigint("item_id", { mode: "number", unsigned: true }).notNull(),
  quantity: decimal("quantity", { precision: 18, scale: 4 }).notNull(),
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
}, (t) => [
  uniqueIndex("award_item_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("award_item_uq").on(t.tenantId, t.awardId, t.itemId),
  foreignKey({ name: "award_item_award_fk", columns: [t.tenantId, t.awardId], foreignColumns: [awards.tenantId, awards.id] }).onDelete("restrict"),
  foreignKey({ name: "award_item_item_fk", columns: [t.tenantId, t.itemId], foreignColumns: [procedureItems.tenantId, procedureItems.id] }).onDelete("restrict"),
]);

export const submissionReceipts = mysqlTable("submission_receipts", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  licitacionId: bigint("licitacion_id", { mode: "number", unsigned: true }).notNull(),
  lotId: bigint("lot_id", { mode: "number", unsigned: true }).notNull(),
  participacionId: bigint("participacion_id", { mode: "number", unsigned: true }).notNull(),
  proposicionId: bigint("proposicion_id", { mode: "number", unsigned: true }).notNull(),
  proveedorId: bigint("proveedor_id", { mode: "number", unsigned: true }).notNull(),
  supplierOrganizationId: bigint("supplier_organization_id", { mode: "number", unsigned: true }).notNull(),
  submittedByUserId: bigint("submitted_by_user_id", { mode: "number", unsigned: true }).notNull(),
  supplierMembershipId: bigint("supplier_membership_id", { mode: "number", unsigned: true }),
  actingAuthorityId: bigint("acting_authority_id", { mode: "number", unsigned: true }),
  receiptType: mysqlEnum("receipt_type", ["SUBMISSION", "WITHDRAWAL", "REPLACEMENT"]).notNull(),
  manifestHash: varchar("manifest_hash", { length: 64 }).notNull(),
  submissionVersion: int("submission_version").default(1).notNull(),
  supersedesProposicionId: bigint("supersedes_proposicion_id", { mode: "number", unsigned: true }),
  serverReceivedAt: timestamp("server_received_at").notNull(),
  receiptHash: varchar("receipt_hash", { length: 64 }).notNull(),
  timestampStatus: mysqlEnum("timestamp_status", ["PENDING_EXTERNAL", "ANCHORED", "FAILED"]).default("PENDING_EXTERNAL").notNull(),
  timestampToken: text("timestamp_token"),
  timestampedAt: timestamp("timestamped_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("submission_receipt_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("submission_receipt_hash_uq").on(t.receiptHash),
  index("submission_receipt_prop_idx").on(t.tenantId, t.proposicionId, t.receiptType),
  foreignKey({ name: "submission_receipt_lot_fk", columns: [t.tenantId, t.lotId], foreignColumns: [procedureLots.tenantId, procedureLots.id] }).onDelete("restrict"),
  foreignKey({ name: "submission_receipt_part_fk", columns: [t.tenantId, t.participacionId], foreignColumns: [participaciones.tenantId, participaciones.id] }).onDelete("restrict"),
  foreignKey({ name: "submission_receipt_prop_fk", columns: [t.tenantId, t.proposicionId], foreignColumns: [proposiciones.tenantId, proposiciones.id] }).onDelete("restrict"),
  foreignKey({ name: "submission_receipt_provider_fk", columns: [t.tenantId, t.proveedorId], foreignColumns: [proveedores.tenantId, proveedores.id] }).onDelete("restrict"),
  foreignKey({ name: "submission_receipt_org_fk", columns: [t.supplierOrganizationId], foreignColumns: [supplierLegalEntities.id] }).onDelete("restrict"),
  foreignKey({ name: "submission_receipt_user_fk", columns: [t.tenantId, t.submittedByUserId], foreignColumns: [users.tenantId, users.id] }).onDelete("restrict"),
]);

export const publicationHeads = mysqlTable("publication_heads", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  licitacionId: bigint("licitacion_id", { mode: "number", unsigned: true }).notNull(),
  lastReleaseNo: int("last_release_no").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("publication_head_lic_uq").on(t.tenantId, t.licitacionId),
  foreignKey({ name: "publication_head_lic_fk", columns: [t.tenantId, t.licitacionId], foreignColumns: [licitaciones.tenantId, licitaciones.id] }).onDelete("restrict"),
]);

export const publicationReleases = mysqlTable("publication_releases", {
  id: serial("id").primaryKey(),
  ...tenantColumns,
  licitacionId: bigint("licitacion_id", { mode: "number", unsigned: true }).notNull(),
  releaseNo: int("release_no").notNull(),
  releaseTag: varchar("release_tag", { length: 100 }).notNull(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  sourceType: varchar("source_type", { length: 80 }).notNull(),
  sourceId: bigint("source_id", { mode: "number", unsigned: true }).notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  payload: json("payload").notNull(),
  publishedBy: bigint("published_by", { mode: "number", unsigned: true }).notNull(),
  publishedAt: timestamp("published_at").defaultNow().notNull(),
  supersedesReleaseId: bigint("supersedes_release_id", { mode: "number", unsigned: true }),
  correctionReason: text("correction_reason"),
}, (t) => [
  uniqueIndex("publication_release_tenant_id_uq").on(t.tenantId, t.id),
  uniqueIndex("publication_release_no_uq").on(t.tenantId, t.licitacionId, t.releaseNo),
  uniqueIndex("publication_release_tag_uq").on(t.tenantId, t.releaseTag),
  index("publication_release_event_idx").on(t.tenantId, t.licitacionId, t.eventType),
  foreignKey({ name: "publication_release_lic_fk", columns: [t.tenantId, t.licitacionId], foreignColumns: [licitaciones.tenantId, licitaciones.id] }).onDelete("restrict"),
  foreignKey({ name: "publication_release_user_fk", columns: [t.tenantId, t.publishedBy], foreignColumns: [users.tenantId, users.id] }).onDelete("restrict"),
]);
