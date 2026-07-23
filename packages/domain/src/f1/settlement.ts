import type { SettlementOutcome } from "../settlement/settlement.js";
import { F1ResultError, resolveF1Selection } from "./results.js";
import { f1MarketKindFromSupplierMarketId } from "./markets.js";
import { parseF1Selection } from "./selections.js";
import type { F1ClassificationEntry, F1SessionState } from "./types.js";

/** One F1 ticket eligible for (re-)settlement: the session's confirmed result
 *  version differs from the ticket's active settlement version. Shapes mirror the
 *  football settlement candidate so both feed the same SettlementService. */
export interface F1SettlementCandidate {
  ticketId: string;
  /** Confirmed session result version as a string (settlement version key). */
  settlementVersion: string;
  activeSettlementVersion: string | null;
  sessionState: F1SessionState;
  resultConfirmed: boolean;
  /** Confirmed classification; null when the session was cancelled outright. */
  classification: F1ClassificationEntry[] | null;
  selection: string;
  supplierMarketId: number;
}

/** Resolves a candidate to WIN/LOSS/PUSH/CANCEL per §12.5. Throws F1ResultError when
 *  the frozen leg or confirmed result is malformed — such tickets go to the retry
 *  queue instead of settling wrongly. */
export function outcomeForF1Candidate(candidate: F1SettlementCandidate): SettlementOutcome {
  if (candidate.sessionState === "CANCELLED") return "CANCEL";
  if (candidate.sessionState !== "FINISHED" || candidate.classification === null) {
    throw new F1ResultError("INVALID_CLASSIFICATION");
  }
  const kind = f1MarketKindFromSupplierMarketId(candidate.supplierMarketId);
  if (kind === null) throw new F1ResultError("INVALID_CLASSIFICATION");
  const selection = parseF1Selection(kind, candidate.selection);
  if (selection === null) throw new F1ResultError("INVALID_CLASSIFICATION");
  return resolveF1Selection(selection, { sessionId: "", version: 0, classification: candidate.classification });
}
