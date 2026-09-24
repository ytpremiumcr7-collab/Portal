import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import {
  organizationalUnits,
  organizationalUnitMemberships,
  authorityDelegations,
  supplierMemberships,
  supplierAuthorities,
  workflowTemplates,
  workflowInstances,
  workTasks,
  taskApprovals,
  procedureLots,
  procedureItems,
  awards,
  awardItems,
  submissionReceipts,
  publicationReleases,
} from "../../db/schema-eproc";
import { licitaciones, participaciones, proposiciones, contratos } from "../../db/schema";

describe("e-procurement persistent topology", () => {
  it("exposes institutional authority and workflow as persisted domain objects", () => {
    expect(getTableName(organizationalUnits)).toBe("organizational_units");
    expect(getTableName(organizationalUnitMemberships)).toBe("organizational_unit_memberships");
    expect(getTableName(authorityDelegations)).toBe("authority_delegations");
    expect(getTableName(workflowTemplates)).toBe("workflow_templates");
    expect(getTableName(workflowInstances)).toBe("workflow_instances");
    expect(getTableName(workTasks)).toBe("work_tasks");
    expect(getTableName(taskApprovals)).toBe("task_approvals");
  });

  it("separates supplier membership from the legacy provider owner pointer", () => {
    expect(getTableName(supplierMemberships)).toBe("supplier_memberships");
    expect(getTableName(supplierAuthorities)).toBe("supplier_authorities");
  });

  it("makes lots/items/awards and evidence/publication first-class", () => {
    expect(getTableName(procedureLots)).toBe("procedure_lots");
    expect(getTableName(procedureItems)).toBe("procedure_items");
    expect(getTableName(awards)).toBe("awards");
    expect(getTableName(awardItems)).toBe("award_items");
    expect(getTableName(submissionReceipts)).toBe("submission_receipts");
    expect(getTableName(publicationReleases)).toBe("publication_releases");
  });

  it("adds expand-first foreign keys to the existing aggregates", () => {
    expect(licitaciones.contractingUnitId).toBeDefined();
    expect(participaciones.lotId).toBeDefined();
    expect(proposiciones.lotId).toBeDefined();
    expect(contratos.awardId).toBeDefined();
  });
});
