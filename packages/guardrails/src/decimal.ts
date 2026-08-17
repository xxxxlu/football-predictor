/**
 * Exact multiplication of an integer by a decimal written as a string.
 *
 * The reason this exists rather than `Math.round(points * Number(odds))`: binary
 * floating point cannot represent most decimal fractions, so `1000 * 2.1` is
 * `2100.0000000000002` and a stake of 3 at odds `1.005` rounds the wrong way. In
 * a ledger those are not rounding artefacts, they are money that does not
 * reconcile. Everything here stays in `BigInt`, and the single rounding step —
 * half away from zero — happens exactly once, at the end.
 */

export class DecimalError extends Error {
  constructor(readonly code: "INVALID_MULTIPLICAND" | "INVALID_DECIMAL" | "RESULT_OUT_OF_RANGE") {
    super(code);
    this.name = "DecimalError";
  }
}

/** Unsigned decimal, no exponent, no leading zeros beyond a bare `0`. */
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** True for a syntactically valid, strictly positive decimal string. */
export function isPositiveDecimal(value: string): boolean {
  return DECIMAL_PATTERN.test(value) && value.replace(/[.0]/g, "").length > 0;
}

/**
 * `multiplicand × decimal`, rounded half up, as a safe integer.
 *
 * Throws rather than returning a wrong number: a malformed decimal, a negative or
 * non-integer multiplicand, and a product past `Number.MAX_SAFE_INTEGER` are all
 * conditions where a caller silently continuing is worse than a refusal.
 */
export function multiplyByDecimal(multiplicand: number, decimal: string): number {
  if (!Number.isSafeInteger(multiplicand) || multiplicand < 0) {
    throw new DecimalError("INVALID_MULTIPLICAND");
  }
  if (!DECIMAL_PATTERN.test(decimal)) throw new DecimalError("INVALID_DECIMAL");

  const [integerPart = "0", fractionPart = ""] = decimal.split(".");
  // An all-zero decimal is syntactically fine and semantically never what a
  // caller meant by a rate or a price; refuse it here rather than return 0.
  if (`${integerPart}${fractionPart}`.replace(/0/g, "").length === 0) {
    throw new DecimalError("INVALID_DECIMAL");
  }

  const denominator = 10n ** BigInt(fractionPart.length);
  const numerator = BigInt(`${integerPart}${fractionPart}`);
  const product = BigInt(multiplicand) * numerator;
  const quotient = product / denominator;
  const remainder = product % denominator;
  // Half up: the comparison is doubled instead of halved so it stays in integers.
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new DecimalError("RESULT_OUT_OF_RANGE");
  return Number(rounded);
}
