/** Formula-based head-to-head pricing (§12.5 v1 市场 4).
 *
 *  Any driver pairing is priced automatically from season points so 231 pairings
 *  never need manual quotes, and a lopsided pair never settles at even money
 *  (avoiding the "risk-free grind" the spec calls out). Admin overrides are stored
 *  at the persistence layer; this module is the deterministic default. */

export interface H2HOddsInput {
  /** Season points of the selected driver. */
  pointsA: number;
  /** Season points of the opponent. */
  pointsB: number;
}

export interface H2HOdds {
  /** Decimal odds that A finishes ahead, 2dp string. */
  oddsA: string;
  /** Decimal odds that B finishes ahead, 2dp string. */
  oddsB: string;
}

/** Laplace-style smoothing so a 0-point rookie still gets a finite price. */
const SMOOTHING_POINTS = 25;
/** Platform margin retained on each side (virtual points, not a cash book). */
const MARGIN = 0.94;
export const H2H_MIN_ODDS = 1.15;
export const H2H_MAX_ODDS = 12;

function clampOdds(value: number): number {
  return Math.min(H2H_MAX_ODDS, Math.max(H2H_MIN_ODDS, value));
}

function toDecimalString(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

export function h2hOdds(input: H2HOddsInput): H2HOdds {
  if (!Number.isFinite(input.pointsA) || !Number.isFinite(input.pointsB) || input.pointsA < 0 || input.pointsB < 0) {
    throw new RangeError("H2H points must be non-negative finite numbers");
  }
  const weightA = input.pointsA + SMOOTHING_POINTS;
  const weightB = input.pointsB + SMOOTHING_POINTS;
  const probabilityA = weightA / (weightA + weightB);
  const probabilityB = 1 - probabilityA;
  return {
    oddsA: toDecimalString(clampOdds((1 / probabilityA) * MARGIN)),
    oddsB: toDecimalString(clampOdds((1 / probabilityB) * MARGIN)),
  };
}
