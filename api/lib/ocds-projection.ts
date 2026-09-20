/**
 * OCDS-like public projection — never leak sealed economic offers pre-apertura.
 * Bid amounts / sealed contents only after apertura ABIERTA|REGISTRADA|ACTA_EMITIDA|PUBLICADA.
 */
import { moneyFixed2, type MoneyInput } from "./money";

export const OCDS_POST_APERTURA = new Set(["ABIERTA", "REGISTRADA", "ACTA_EMITIDA", "PUBLICADA"]);

export const OCDS_PUBLIC_CONTRACT_ESTADOS = new Set(["FORMALIZADO", "VIGENTE", "TERMINADO"]);

export function isAperturaEconomiaPublica(aperturaEstado: string | null | undefined): boolean {
  return !!aperturaEstado && OCDS_POST_APERTURA.has(aperturaEstado);
}

export type OcdsBidInput = {
  id: number | string;
  proveedorId: number | string;
  /** Economic amount — omitted/redacted until apertura reveals. */
  montoOferta?: MoneyInput | null;
  date?: string | Date | null;
  status?: string | null;
};

export type OcdsProcInput = {
  id: number;
  tenantId: number;
  codigo: string | null;
  titulo: string | null;
  objeto: string | null;
  estado: string;
  tipoLicitacion: string | null;
  tipoContratacion: string | null;
  montoPresupuestado: MoneyInput | null;
  fechaPublicacion: string | Date | null;
  fechaCierre: string | Date | null;
  createdAt?: string | Date | null;
};

export type OcdsAwardInput = {
  id: number;
  publicadoAt: string | Date | null;
  montoAdjudicado: MoneyInput | null;
  proveedorGanadorId: number | null;
};

export type OcdsContractInput = {
  id: number;
  folio: string | null;
  estado: string;
  monto: MoneyInput | null;
  fechaInicio: string | Date | null;
  fechaFin: string | Date | null;
  fechaFirma: string | Date | null;
};

export type BuildOcdsReleaseInput = {
  proc: OcdsProcInput;
  award?: OcdsAwardInput | null;
  contract?: OcdsContractInput | null;
  /** Optional bids — amounts redacted unless aperturaEconomiaPublica. */
  bids?: OcdsBidInput[];
  aperturaEstado?: string | null;
};

/** Pure projector for consultaPublica.ocdsRelease (unit-testable). */
export function buildOcdsRelease(input: BuildOcdsReleaseInput) {
  const { proc, award, contract, bids, aperturaEstado } = input;
  const ocid = `ocds-ares-mx-${proc.tenantId}-${proc.codigo ?? proc.id}`;
  const budgetAmt = proc.montoPresupuestado != null ? Number(moneyFixed2(proc.montoPresupuestado)) : null;
  const economiaPublica = isAperturaEconomiaPublica(aperturaEstado);

  const bidItems = (bids ?? []).map((b) => {
    const base: Record<string, unknown> = {
      id: `bid-${b.id}`,
      tenderers: [{ id: String(b.proveedorId) }],
      date: b.date ?? null,
      status: b.status ?? "pending",
    };
    if (economiaPublica && b.montoOferta != null && b.montoOferta !== "") {
      base.value = { amount: Number(moneyFixed2(b.montoOferta)), currency: "MXN" };
    } else {
      // Explicit redaction marker — never emit pre-apertura economic amounts.
      base.value = null;
      base.sealed = true;
    }
    return base;
  });

  const publicContract =
    contract && OCDS_PUBLIC_CONTRACT_ESTADOS.has(contract.estado) ? contract : null;

  return {
    ocid,
    id: `${ocid}-release-1`,
    date: proc.fechaPublicacion ?? proc.createdAt ?? null,
    tag: ["tender"] as string[],
    initiationType: "tender",
    planning: {
      budget: budgetAmt != null ? { amount: { amount: budgetAmt, currency: "MXN" } } : undefined,
      rationale: proc.objeto,
    },
    tender: {
      id: proc.codigo,
      title: proc.titulo,
      description: proc.objeto,
      status: proc.estado,
      procurementMethod: proc.tipoLicitacion,
      procurementMethodDetails: proc.tipoContratacion,
      tenderPeriod: { startDate: proc.fechaPublicacion, endDate: proc.fechaCierre },
      value: budgetAmt != null ? { amount: budgetAmt, currency: "MXN" } : undefined,
    },
    awards: award
      ? [{
          id: `award-${award.id}`,
          status: "active",
          date: award.publicadoAt,
          value: {
            amount: Number(moneyFixed2(award.montoAdjudicado ?? 0)),
            currency: "MXN",
          },
          suppliers: [{ id: String(award.proveedorGanadorId) }],
        }]
      : [],
    contracts: publicContract
      ? [{
          id: publicContract.folio,
          awardID: award ? `award-${award.id}` : undefined,
          status: publicContract.estado,
          period: { startDate: publicContract.fechaInicio, endDate: publicContract.fechaFin },
          value: {
            amount: Number(moneyFixed2(publicContract.monto ?? 0)),
            currency: "MXN",
          },
          dateSigned: publicContract.fechaFirma,
        }]
      : [],
    bids: bidItems.length ? { details: bidItems } : undefined,
    meta: {
      aperturaEstado: aperturaEstado ?? null,
      economiaOfertasPublica: economiaPublica,
    },
  };
}

/** Flatten release JSON and assert no sealed-offer amount keys leaked under bids when not public. */
export function assertNoPreAperturaBidMontos(
  release: ReturnType<typeof buildOcdsRelease>,
): void {
  if (release.meta.economiaOfertasPublica) return;
  const details = release.bids?.details ?? [];
  for (const b of details) {
    if (b.value != null) {
      throw new Error("OCDS leak: bid value present before apertura publica");
    }
    if ((b as { sealed?: boolean }).sealed !== true) {
      throw new Error("OCDS leak: sealed bid missing redaction marker");
    }
  }
}
