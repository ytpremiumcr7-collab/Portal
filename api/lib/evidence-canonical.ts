import { createHash } from "node:crypto";

export const EVIDENCE_SCHEMA_V1 = 1;
export const EVIDENCE_SCHEMA_V2 = 2;

export type EvidenceV1Input = {
  expedienteId: number;
  secuencia: number;
  tipo: string;
  estadoAnterior: string | null;
  estadoNuevo: string | null;
  actorUserId: number;
  motivo: string | null;
  payload: unknown;
  timestamp: string;
  previousHash: string | null;
};

export type EvidenceV2Input = EvidenceV1Input & {
  schemaVersion: number;
  tenantId: number;
  actorCapability: string | null;
  requestId: string;
  sourceIp: string | null;
  verifiedClientIp: string | null;
};

export function canonicalEventV1(input: EvidenceV1Input): string {
  return JSON.stringify({
    expedienteId: input.expedienteId,
    secuencia: input.secuencia,
    tipo: input.tipo,
    estadoAnterior: input.estadoAnterior,
    estadoNuevo: input.estadoNuevo,
    actorUserId: input.actorUserId,
    motivo: input.motivo,
    payload: input.payload,
    timestamp: input.timestamp,
    previousHash: input.previousHash,
  });
}

export function canonicalEventV2(input: EvidenceV2Input): string {
  const envelope = {
    actorCapability: input.actorCapability,
    actorUserId: input.actorUserId,
    estadoAnterior: input.estadoAnterior,
    estadoNuevo: input.estadoNuevo,
    expedienteId: input.expedienteId,
    motivo: input.motivo,
    payload: input.payload,
    previousHash: input.previousHash,
    requestId: input.requestId,
    schemaVersion: EVIDENCE_SCHEMA_V2,
    secuencia: input.secuencia,
    sourceIp: input.sourceIp,
    tenantId: input.tenantId,
    timestamp: input.timestamp,
    tipo: input.tipo,
    verifiedClientIp: input.verifiedClientIp,
  };
  return JSON.stringify(envelope);
}

export function hashCanonical(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex");
}

export function schemaVersionOf(row: { schemaVersion?: number | null }): number {
  const v = Number(row.schemaVersion ?? EVIDENCE_SCHEMA_V1);
  return v >= EVIDENCE_SCHEMA_V2 ? EVIDENCE_SCHEMA_V2 : EVIDENCE_SCHEMA_V1;
}
