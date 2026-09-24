import { describe, expect, it } from "vitest";
import {
  evaluateSupplierActionAuthority,
  type SupplierAction,
} from "./supplier-authority";
import { buildProposicionManifest } from "./proposicion";

const now = new Date("2026-09-24T18:00:00.000Z");

describe("supplier organization authority", () => {
  const membership = {
    id: 11,
    tenantId: 1,
    proveedorId: 40,
    userId: 10,
    role: "SIGNER",
    active: true,
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validUntil: null,
  } as const;
  const authority = {
    id: 12,
    tenantId: 1,
    proveedorId: 40,
    userId: 10,
    authorityType: "SIGNATURE",
    authoritySource: "VERIFIED_DOCUMENT",
    scope: { procedureIds: [20], lotIds: [2], actions: ["SUBMIT", "WITHDRAW"] },
    documentId: 77,
    active: true,
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validUntil: null,
  } as const;

  it.each(["SUBMIT", "WITHDRAW"] satisfies SupplierAction[])(
    "requires a current membership and scoped authority for %s",
    (action) => {
      const result = evaluateSupplierActionAuthority({
        tenantId: 1,
        actorUserId: 10,
        proveedorId: 40,
        procedureId: 20,
        lotId: 2,
        action,
        now,
        memberships: [membership],
        authorities: [authority],
      });
      expect(result).toMatchObject({
        ok: true,
        membershipId: 11,
        authorityId: 12,
        representedProveedorId: 40,
        actorUserId: 10,
      });
    },
  );

  it("refuses authority leakage across provider, procedure or lot", () => {
    for (const patch of [
      { proveedorId: 41 },
      { procedureId: 21 },
      { lotId: 3 },
    ]) {
      const result = evaluateSupplierActionAuthority({
        tenantId: 1,
        actorUserId: 10,
        proveedorId: patch.proveedorId ?? 40,
        procedureId: patch.procedureId ?? 20,
        lotId: patch.lotId ?? 2,
        action: "SUBMIT",
        now,
        memberships: [membership],
        authorities: [authority],
      });
      expect(result.ok).toBe(false);
    }
  });

  it("refuses expired authority even when membership remains active", () => {
    const result = evaluateSupplierActionAuthority({
      tenantId: 1,
      actorUserId: 10,
      proveedorId: 40,
      procedureId: 20,
      lotId: 2,
      action: "SUBMIT",
      now,
      memberships: [membership],
      authorities: [{ ...authority, validUntil: new Date("2026-09-23T00:00:00.000Z") }],
    });
    expect(result.ok).toBe(false);
  });
});

describe("submission manifest acting-as evidence", () => {
  it("binds lot, actor, supplier membership and authority into the immutable manifest", () => {
    const common = {
      proposicionId: 30,
      participacionId: 31,
      proveedorId: 40,
      lotId: 2,
      actorUserId: 10,
      supplierMembershipId: 11,
      actingAuthorityId: 12,
      ciphertextHash: "b".repeat(64),
      recibidoAt: now,
      documentos: [
        { documentoId: 100, rol: "OFERTA_TECNICA" as const, sha256: "c".repeat(64) },
        { documentoId: 101, rol: "OFERTA_ECONOMICA" as const, sha256: "d".repeat(64) },
      ],
    };
    const one = buildProposicionManifest(common);
    const otherLot = buildProposicionManifest({ ...common, lotId: 3 });
    const otherAuthority = buildProposicionManifest({ ...common, actingAuthorityId: 13 });

    expect(one.payload).toMatchObject({
      lotId: 2,
      actorUserId: 10,
      supplierMembershipId: 11,
      actingAuthorityId: 12,
    });
    expect(one.manifestHash).not.toBe(otherLot.manifestHash);
    expect(one.manifestHash).not.toBe(otherAuthority.manifestHash);
  });
});
