/** Formula-based exact-podium (领奖台之争) combo pricing.
 *
 *  The market stores one base outcome per driver (`DRV:<code>` with that driver's
 *  field odds). Enumerating every ordered P1-P2-P3 combination (22 drivers → 9,240
 *  outcomes) would bloat each odds snapshot past the API gateway's response limits,
 *  so combo odds are derived deterministically from the versioned base odds instead:
 *  the same formula runs at seed time, at submission validation and in the client
 *  composer, and the derived price is frozen onto the ticket leg as usual.
 *
 *  The formula matches the previously enumerated seed pricing exactly:
 *  clamp(6, 500, (oddsP1 × oddsP2 × oddsP3) / 2.5), rounded to 2dp. */

export const EXACT_PODIUM_MIN_ODDS = 6;
export const EXACT_PODIUM_MAX_ODDS = 500;
/** Divisor folding the platform margin into the naive product of field odds. */
const COMBO_DIVISOR = 2.5;

const DECIMAL_ODDS = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** Derives the decimal odds (2dp string) for an ordered podium combination from the
 *  three drivers' base odds strings, or null when any base odds is malformed. */
export function exactPodiumComboOdds(baseOdds: readonly [string, string, string]): string | null {
  const values = baseOdds.map((odds) => (DECIMAL_ODDS.test(odds) ? Number(odds) : Number.NaN));
  const product = values.reduce((combined, value) => combined * value, 1);
  if (!Number.isFinite(product) || product <= 0) return null;
  const clamped = Math.min(EXACT_PODIUM_MAX_ODDS, Math.max(EXACT_PODIUM_MIN_ODDS, product / COMBO_DIVISOR));
  return (Math.round(clamped * 100) / 100).toFixed(2);
}
