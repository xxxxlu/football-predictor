/** Prediction market kinds and correct-score metadata shared by submission, settlement and platform odds generation. */
export type MarketKind = "ONE_X_TWO" | "CORRECT_SCORE";

export const ONE_X_TWO_SUPPLIER_MARKET_ID = 1;
export const CORRECT_SCORE_SUPPLIER_MARKET_ID = 2;

export function marketKindFromSupplierMarketId(supplierMarketId: number): MarketKind {
  return supplierMarketId === CORRECT_SCORE_SUPPLIER_MARKET_ID ? "CORRECT_SCORE" : "ONE_X_TWO";
}

/** The 16 explicitly listed correct scores the platform offers, in display order. */
export const CORRECT_SCORE_SELECTIONS = [
  "0-0", "1-0", "0-1", "1-1", "2-0", "0-2", "2-1", "1-2",
  "2-2", "3-0", "0-3", "3-1", "1-3", "3-2", "2-3", "3-3",
] as const;

/** Catch-all selection for any final score outside the listed set. */
export const CORRECT_SCORE_OTHER = "OTHER";

/** Every correct-score selection including the OTHER catch-all, in display order. */
export const CORRECT_SCORE_MARKET_SELECTIONS: readonly string[] = [...CORRECT_SCORE_SELECTIONS, CORRECT_SCORE_OTHER];

export function isListedCorrectScore(value: string): boolean {
  return (CORRECT_SCORE_SELECTIONS as readonly string[]).includes(value);
}

export function isCorrectScoreSelection(value: string): boolean {
  return value === CORRECT_SCORE_OTHER || isListedCorrectScore(value);
}

/** Winning correct-score selection for a final score: the exact score when listed, otherwise OTHER. */
export function correctScoreSelectionForResult(homeScore: number, awayScore: number): string {
  const exact = `${homeScore}-${awayScore}`;
  return isListedCorrectScore(exact) ? exact : CORRECT_SCORE_OTHER;
}
