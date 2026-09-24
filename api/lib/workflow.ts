import { and, asc, eq, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  workflowTemplates, workflowTemplateSteps, workflowInstances, workTasks,
} from "@db/schema-eproc";
import { getDb } from "../queries/connection";
import { assertWorkTaskTransition, type WorkTaskState } from "./eproc-core";

export type WorkTaskCommand = "CLAIM" | "SUBMIT" | "APPROVE" | "REJECT" | "RETURN" | "CANCEL" | "EXPIRE";
export type WorkTaskCompletionMode = "EXECUTE" | "REVIEW" | "APPROVE" | "SIGN";

export function assertTaskCommandAllowed(mode: WorkTaskCompletionMode, command: WorkTaskCommand) {
  if (command === "APPROVE" && mode === "REVIEW") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Una tarea de revisión debe enviarse a revisión y ser decidida por una segunda persona.",
    });
  }
  if (command === "SUBMIT" && mode !== "REVIEW") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Sólo una tarea REVIEW puede enviarse a revisión.",
    });
  }
}

export function nextTaskState(current: WorkTaskState, command: WorkTaskCommand): WorkTaskState {
  const target: Record<WorkTaskCommand, WorkTaskState> = {
    CLAIM: "EN_PROGRESO",
    SUBMIT: "EN_REVISION",
    APPROVE: "APROBADA",
    REJECT: "RECHAZADA",
    RETURN: "DEVUELTA",
    CANCEL: "CANCELADA",
    EXPIRE: "VENCIDA",
  };
  const next = target[command];
  assertWorkTaskTransition(current, next);
  return next;
}

export function assertPreviousTasksComplete(
  tasks: Array<{ sequence: number; state: string }>,
  currentSequence: number,
) {
  const pending = tasks.filter((t) => t.sequence < currentSequence && t.state !== "APROBADA");
  if (pending.length) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Hay tareas previas sin aprobar: ${pending.map((t) => `#${t.sequence} ${t.state}`).join(", ")}.`,
    });
  }
}

export const STANDARD_WORKFLOW_CODE = "STANDARD_PROCEDURE";
export const STANDARD_WORKFLOW_VERSION = 1;

const STANDARD_STEPS = [
  { sequence: 10, actionCode: "PREPARAR_PROCEDIMIENTO", title: "Preparar procedimiento", requiredRole: "OPERADOR", completionMode: "EXECUTE", dueHours: 72 },
  { sequence: 20, actionCode: "REVISION_TECNICA", title: "Revisión técnica", requiredRole: "TECNICO", completionMode: "REVIEW", dueHours: 48 },
  { sequence: 30, actionCode: "REVISION_JURIDICA", title: "Revisión jurídica", requiredRole: "JURIDICO", completionMode: "REVIEW", dueHours: 48 },
  { sequence: 40, actionCode: "AUTORIZAR_PUBLICACION", title: "Autorizar publicación", requiredRole: "APROBADOR", completionMode: "APPROVE", dueHours: 24 },
] as const;

export async function ensureStandardWorkflowTemplate(tx: any, tenantId: number, actorUserId: number) {
  let template = await tx.query.workflowTemplates.findFirst({
    where: and(
      eq(workflowTemplates.tenantId, tenantId),
      eq(workflowTemplates.code, STANDARD_WORKFLOW_CODE),
      eq(workflowTemplates.version, STANDARD_WORKFLOW_VERSION),
    ),
  });
  if (template) return template;

  const inserted = await tx.insert(workflowTemplates).values({
    tenantId, code: STANDARD_WORKFLOW_CODE, version: STANDARD_WORKFLOW_VERSION,
    name: "Procedimiento institucional estándar", active: true, createdBy: actorUserId,
  });
  const templateId = Number(inserted[0].insertId);
  for (const step of STANDARD_STEPS) {
    await tx.insert(workflowTemplateSteps).values({ tenantId, templateId, ...step });
  }
  template = await tx.query.workflowTemplates.findFirst({
    where: and(eq(workflowTemplates.tenantId, tenantId), eq(workflowTemplates.id, templateId)),
  });
  if (!template) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No fue posible crear la plantilla de workflow." });
  return template;
}

export async function instantiateProcedureWorkflow(
  tx: any,
  input: { tenantId: number; licitacionId: number; unitId: number; actorUserId: number },
) {
  const existing = await tx.query.workflowInstances.findFirst({
    where: and(eq(workflowInstances.tenantId, input.tenantId), eq(workflowInstances.licitacionId, input.licitacionId)),
  });
  if (existing) return existing;

  const template = await ensureStandardWorkflowTemplate(tx, input.tenantId, input.actorUserId);
  const inserted = await tx.insert(workflowInstances).values({
    tenantId: input.tenantId, licitacionId: input.licitacionId,
    templateId: template.id, templateVersion: template.version, status: "RUNNING",
  });
  const workflowInstanceId = Number(inserted[0].insertId);
  const steps = await tx.query.workflowTemplateSteps.findMany({
    where: and(eq(workflowTemplateSteps.tenantId, input.tenantId), eq(workflowTemplateSteps.templateId, template.id)),
    orderBy: [asc(workflowTemplateSteps.sequence)],
  });
  const now = Date.now();
  for (const step of steps) {
    await tx.insert(workTasks).values({
      tenantId: input.tenantId, workflowInstanceId, licitacionId: input.licitacionId,
      templateStepId: step.id, sequence: step.sequence, actionCode: step.actionCode,
      title: step.title, requiredRole: step.requiredRole, completionMode: step.completionMode,
      state: "PENDIENTE", assignedUnitId: input.unitId,
      dueAt: step.dueHours == null ? null : new Date(now + step.dueHours * 60 * 60 * 1000),
      createdBy: input.actorUserId,
    });
  }
  return tx.query.workflowInstances.findFirst({
    where: and(eq(workflowInstances.tenantId, input.tenantId), eq(workflowInstances.id, workflowInstanceId)),
  });
}

export async function assertPreviousTasksCompleteInDb(tx: any, task: typeof workTasks.$inferSelect) {
  const previous = await tx.query.workTasks.findMany({
    where: and(
      eq(workTasks.tenantId, task.tenantId),
      eq(workTasks.workflowInstanceId, task.workflowInstanceId),
      lt(workTasks.sequence, task.sequence),
    ),
  });
  assertPreviousTasksComplete(previous, task.sequence);
  return previous;
}

export async function assertProcedureTaskApproved(tenantId: number, licitacionId: number, actionCode: string) {
  const db = getDb();
  const instance = await db.query.workflowInstances.findFirst({
    where: and(eq(workflowInstances.tenantId, tenantId), eq(workflowInstances.licitacionId, licitacionId), eq(workflowInstances.status, "RUNNING")),
  });
  if (!instance) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El procedimiento no tiene workflow institucional activo." });
  const task = await db.query.workTasks.findFirst({
    where: and(
      eq(workTasks.tenantId, tenantId),
      eq(workTasks.workflowInstanceId, instance.id),
      eq(workTasks.actionCode, actionCode),
    ),
  });
  if (!task || task.state !== "APROBADA") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `La tarea ${actionCode} debe estar APROBADA antes de ejecutar este acto.` });
  }
  return task;
}
