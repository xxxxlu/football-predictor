import { correctScoreSelectionForResult, marketKindFromSupplierMarketId } from "@pulse/domain";

export type CandidateMatchStatus = "FINISHED" | "CANCELLED" | "POSTPONED" | "SUSPENDED" | "SCHEDULED" | "LIVE";

export interface SettlementCandidate {
  ticketId: string;
  settlementVersion: string;
  activeSettlementVersion: string | null;
  matchStatus: CandidateMatchStatus;
  resultConfirmed: boolean;
  homeScore: number | null;
  awayScore: number | null;
  selection: string;
  supplierMarketId: number;
}

export interface SettlementCandidatePort {
  scan(limit: number): Promise<SettlementCandidate[]>;
  get(ticketId: string): Promise<SettlementCandidate | null>;
}

type SettleInput = {
  ticketId: string; settlementVersion: string; matchStatus: "FINAL" | "CANCELLED"; resultConfirmed: boolean;
  outcome?: "WIN" | "LOSS" | "PUSH";
};
type CorrectInput = SettleInput & { previousSettlementVersion: string };

export interface SettlementApplicationPort {
  settle(input: SettleInput): Promise<unknown>;
  correct(input: CorrectInput): Promise<unknown>;
}

export function outcomeForCandidate(candidate: SettlementCandidate): "WIN" | "LOSS" | "CANCEL" {
  if (candidate.matchStatus === "CANCELLED") return "CANCEL";
  if (candidate.matchStatus !== "FINISHED" || candidate.homeScore === null || candidate.awayScore === null) throw new Error("Result is not settleable");
  const winningSelection = marketKindFromSupplierMarketId(candidate.supplierMarketId) === "CORRECT_SCORE"
    ? correctScoreSelectionForResult(candidate.homeScore, candidate.awayScore)
    : candidate.homeScore > candidate.awayScore ? "HOME" : candidate.homeScore < candidate.awayScore ? "AWAY" : "DRAW";
  return candidate.selection === winningSelection ? "WIN" : "LOSS";
}

type Dependencies = { candidates: SettlementCandidatePort; settlement: SettlementApplicationPort };

async function processCandidate(dependencies: Dependencies, candidate: SettlementCandidate): Promise<"PROCESSED" | "HELD"> {
  if (!candidate.resultConfirmed || (candidate.matchStatus !== "FINISHED" && candidate.matchStatus !== "CANCELLED")) return "HELD";
  const outcome = outcomeForCandidate(candidate);
  const base = {
    ticketId: candidate.ticketId,
    settlementVersion: candidate.settlementVersion,
    matchStatus: candidate.matchStatus === "CANCELLED" ? "CANCELLED" as const : "FINAL" as const,
    resultConfirmed: true,
    ...(outcome === "CANCEL" ? {} : { outcome }),
  };
  if (candidate.activeSettlementVersion === null) await dependencies.settlement.settle(base);
  else if (candidate.activeSettlementVersion !== candidate.settlementVersion) {
    await dependencies.settlement.correct({ ...base, previousSettlementVersion: candidate.activeSettlementVersion });
  } else return "HELD";
  return "PROCESSED";
}

export function createSettlementJobHandler(dependencies: Dependencies) {
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
  };
}

export function createSettlementRetryService(dependencies: Dependencies) {
  return {
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
