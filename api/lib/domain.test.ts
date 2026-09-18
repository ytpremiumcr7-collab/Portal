import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { assertDateOrder, validateWeights, validateRubric } from "./domain";

function message(fn: () => unknown) {
  try { fn(); return ""; } catch (error) { return error instanceof TRPCError ? error.message : String(error); }
}

describe("ARES Engine MX - reglas de dominio", () => {
  it("exige cierre estrictamente posterior a publicación", () => {
    expect(message(() => assertDateOrder("2026-09-20", "2026-09-20", "2026-09-20"))).toContain("estrictamente posterior");
    expect(() => assertDateOrder("2026-09-20", "2026-09-21", "2026-09-21")).not.toThrow();
  });
  it("exige ponderaciones que sumen 100", () => {
    expect(() => validateWeights("40.00", "60.00")).not.toThrow();
    expect(message(() => validateWeights("50.00", "40.00"))).toContain("sumar exactamente 100");
  });
  it("valida rúbrica técnica completa", () => {
    expect(validateRubric('[{"codigo":"TEC","peso":70},{"codigo":"EXP","peso":30}]')).toHaveLength(2);
    expect(message(() => validateRubric('[{"codigo":"TEC","peso":60}]'))).toContain("sumar 100");
  });
});
