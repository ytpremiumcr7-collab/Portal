import { TRPCError } from "@trpc/server";

/**
 * Four-eyes / two-person rule: approver must be a different user than requester
 * (and optionally the beneficiary / subject of the grant).
 */
export function assertFourEyesActorInequality(opts: {
  approverUserId: number;
  requesterUserId: number | null | undefined;
  beneficiaryUserId?: number | null;
  label?: string;
}) {
  const label = opts.label ?? "cuatro ojos";
  const approver = Number(opts.approverUserId);
  const requester = opts.requesterUserId != null ? Number(opts.requesterUserId) : null;
  const beneficiary = opts.beneficiaryUserId != null ? Number(opts.beneficiaryUserId) : null;
  if (requester != null && approver === requester) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `El aprobador debe ser distinto del solicitante (${label}).`,
    });
  }
  if (beneficiary != null && approver === beneficiary) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `El aprobador debe ser distinto del beneficiario (${label}).`,
    });
  }
}
