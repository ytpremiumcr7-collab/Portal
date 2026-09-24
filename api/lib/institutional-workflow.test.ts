import { describe, expect, it } from "vitest";
import {
  institutionalRolesForProcedureRoles,
  authoritySnapshot,
} from "./institutional-authority";
import {
  nextTaskState,
  assertPreviousTasksComplete,
} from "./workflow";

describe("procedure authority mapping", () => {
  it("maps procedure responsibilities to institutional authority", () => {
    expect(institutionalRolesForProcedureRoles(["creador"])).toEqual(["OPERADOR"]);
    expect(institutionalRolesForProcedureRoles(["evaluador_tecnico", "evaluador_economico"])).toEqual(["TECNICO"]);
    expect(institutionalRolesForProcedureRoles(["dictaminador"])).toEqual(["JURIDICO"]);
    expect(institutionalRolesForProcedureRoles(["autorizador_fallo"])).toEqual(["APROBADOR"]);
    expect(institutionalRolesForProcedureRoles(["aprobar_pago"])).toEqual(["PRESUPUESTO"]);
    expect(institutionalRolesForProcedureRoles(["administrar_ejecucion"])).toEqual(["ADMIN_CONTRATO"]);
  });

  it("keeps the exact authority record in the snapshot", () => {
    expect(authoritySnapshot({
      source: "MEMBERSHIP",
      authorityId: 77,
      unitId: 5,
      actorUserId: 12,
      roles: ["APROBADOR"],
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validUntil: null,
    })).toMatchObject({
      source: "MEMBERSHIP",
      authorityId: 77,
      unitId: 5,
      actorUserId: 12,
      roles: ["APROBADOR"],
    });
  });
});

describe("workflow sequencing", () => {
  it("supports return/rework without reopening approved work", () => {
    expect(nextTaskState("PENDIENTE", "CLAIM")).toBe("EN_PROGRESO");
    expect(nextTaskState("EN_PROGRESO", "SUBMIT")).toBe("EN_REVISION");
    expect(nextTaskState("EN_REVISION", "RETURN")).toBe("DEVUELTA");
    expect(nextTaskState("DEVUELTA", "CLAIM")).toBe("EN_PROGRESO");
    expect(nextTaskState("EN_REVISION", "APPROVE")).toBe("APROBADA");
    expect(() => nextTaskState("APROBADA", "CLAIM")).toThrow();
  });

  it("blocks a task until every earlier task is approved", () => {
    expect(() => assertPreviousTasksComplete([
      { sequence: 10, state: "APROBADA" },
      { sequence: 20, state: "APROBADA" },
    ], 30)).not.toThrow();

    expect(() => assertPreviousTasksComplete([
      { sequence: 10, state: "APROBADA" },
      { sequence: 20, state: "EN_REVISION" },
    ], 30)).toThrow(/previas/i);
  });
});
