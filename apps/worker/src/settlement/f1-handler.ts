import { outcomeForF1Candidate, type F1SettlementCandidate } from "@football-predictor/domain";
import type { SettlementApplicationPort } from "./handler.js";

export interface F1SettlementCandidatePort {
  scan(limit: number): Promise<F1SettlementCandidate[]>;
  get(ticketId: string): Promise<F1SettlementCandidate | null>;
}

type Dependencies = { candidates: F1SettlementCandidatePort; settlement: SettlementApplicationPort };

/** Settles one F1 candidate through the shared SettlementService. CANCEL outcomes
 *  (session void or DNS refund, §12.5) route via matchStatus CANCELLED; a version
 *  change on an already-settled ticket reverses and re-settles (correction). */
async function processCandidate(dependencies: Dependencies, candidate: F1SettlementCandidate): Promise<"PROCESSED" | "HELD"> {
  if (!candidate.resultConfirmed || (candidate.sessionState !== "FINISHED" && candidate.sessionState !== "CANCELLED")) return "HELD";
  const outcome = outcomeForF1Candidate(candidate);
  const base = {
    ticketId: candidate.ticketId,
    settlementVersion: candidate.settlementVersion,
    matchStatus: outcome === "CANCEL" ? "CANCELLED" as const : "FINAL" as const,
    resultConfirmed: true,
    ...(outcome === "CANCEL" ? {} : { outcome }),
  };
  if (candidate.activeSettlementVersion === null) await dependencies.settlement.settle(base);
  else if (candidate.activeSettlementVersion !== candidate.settlementVersion) {
    await dependencies.settlement.correct({ ...base, previousSettlementVersion: candidate.activeSettlementVersion });
  } else return "HELD";
  return "PROCESSED";
}

export function createF1SettlementJobHandler(dependencies: Dependencies) {
  return {
    async scan(input: { limit: number }) {
      const candidates = await dependencies.candidates.scan(input.limit);
      let processed = 0;
      let held = 0;
      const failedTicketIds: string[] = [];
      for (const candidate of candidates) {
        try {
          const result = await processCandidate(dependencies, candidate);
          if (result === "PROCESSED") processed += 1;
          else held += 1;
        } catch {
          failedTicketIds.push(candidate.ticketId);
        }
      }
      return { outcome: failedTicketIds.length ? "RETRY" as const : "SUCCESS" as const, processed, held, failedTicketIds };
    },
    async retry(ticketId: string) {
      const candidate = await dependencies.candidates.get(ticketId);
      if (!candidate) return { outcome: "NOT_FOUND" as const, ticketId };
      try {
        const result = await processCandidate(dependencies, candidate);
        return { outcome: result === "PROCESSED" ? "SUCCESS" as const : "HELD" as const, ticketId };
      } catch {
        return { outcome: "RETRY" as const, ticketId };
      }
    },
  };
}
