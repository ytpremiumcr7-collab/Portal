/**
 * Money / score-critical arithmetic — never use IEEE-754 Number for MXN amounts.
 * Storage remains decimal strings (2 places); computation uses decimal.js.
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = string | number | Decimal;

/** Parse a money/score value; rejects non-finite Number and empty strings. */
export function money(value: MoneyInput): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Importe no finito: ${value}`);
    }
    // Prefer string path for decimals that came from Number (still lossy if already corrupted).
    return new Decimal(String(value));
  }
  const s = String(value).trim();
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Importe inválido: ${value}`);
  }
  return new Decimal(s);
}

/** Fixed 2-decimal MXN (or score) string. */
export function moneyFixed2(value: MoneyInput): string {
  return money(value).toFixed(2);
}

/** Integer minor units (centavos). Prefer for accumulators when possible. */
export function toCentavos(value: MoneyInput): bigint {
  return BigInt(money(value).mul(100).toFixed(0, Decimal.ROUND_HALF_UP));
}

export function fromCentavos(centavos: bigint | number): string {
  return new Decimal(String(centavos)).div(100).toFixed(2);
}

export function moneyAdd(...values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(money(v)), new Decimal(0));
}

export function moneySub(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).minus(money(b));
}

export function moneyMul(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).mul(money(b));
}

export function moneyDiv(a: MoneyInput, b: MoneyInput): Decimal {
  const d = money(b);
  if (d.isZero()) throw new Error("División por cero en importe.");
  return money(a).div(d);
}

export function moneyCmp(a: MoneyInput, b: MoneyInput): number {
  return money(a).cmp(money(b));
}

export function moneyGt(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).gt(money(b));
}

export function moneyGte(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).gte(money(b));
}

export function moneyLt(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).lt(money(b));
}

export function moneyLte(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).lte(money(b));
}

export function moneyMin(...values: MoneyInput[]): Decimal {
  if (!values.length) throw new Error("moneyMin sin valores");
  return values.map(money).reduce((a, b) => (a.lte(b) ? a : b));
}

export function moneyMax(...values: MoneyInput[]): Decimal {
  if (!values.length) throw new Error("moneyMax sin valores");
  return values.map(money).reduce((a, b) => (a.gte(b) ? a : b));
}

/** Absolute difference ≤ tolerance (default 0.01 MXN). */
export function moneyAlmostEqual(a: MoneyInput, b: MoneyInput, tolerance: MoneyInput = "0.01"): boolean {
  return money(a).minus(money(b)).abs().lte(money(tolerance));
}

/** Clamp to [lo, hi]. */
export function moneyClamp(value: MoneyInput, lo: MoneyInput, hi: MoneyInput): Decimal {
  const v = money(value);
  const a = money(lo);
  const b = money(hi);
  if (v.lt(a)) return a;
  if (v.gt(b)) return b;
  return v;
}

export { Decimal };
