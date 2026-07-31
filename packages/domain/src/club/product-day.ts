/**
 * The club product day (Story 12.2, AC1).
 *
 * One implementation, UTC date string — isomorphic to `utcBillingDay` in
 * supplier-budget (kept separate on purpose: if PM later pins a product
 * timezone, only this function changes and billing stays UTC). The server
 * clock decides the day; client dates never participate.
 */

export function productDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

export function previousProductDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - DAY_MS).toISOString().slice(0, 10);
}

/** Days since the Unix epoch — the deterministic rotation index for the bank. */
export function productDayNumber(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00.000Z`) / DAY_MS);
}
