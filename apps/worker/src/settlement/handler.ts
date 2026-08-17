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

/**
 * Why a settlement candidate did not settle.
 *
 * The catch here used to be bare: the ticket id went into `failedTicketIds` and
 * the error itself was dropped, so a whole sweep could fail on every candidate
 * and leave nothing to diagnose it with — an operator saw a list of ids and no
 * reason. `SettlementError` carries the reason in `code` (SETTLEMENT_CONFLICT,
 * INSUFFICIENT_FROZEN, INVALID_ODDS …), which is exactly what distinguishes
 * "this needs a retry" from "this ticket is wedged and needs a decision".
 *
 * The convention-correct form is the injected structured `write` the worker
 * runtime already threads for its own events; this writes to stderr instead so
 * the change stays inside one file. Both end up in the same container log. Only
 * codes and ids are emitted — never balances, stakes or the error object.
 */
function reportCandidateFailure(candidate: SettlementCandidate, error: unknown): void {
  const reason = error instanceof Error
    ? (error as Error & { code?: string }).code ?? error.name
    : typeof error;
  process.stderr.write(`${JSON.stringify({
    event: "settlement.candidate_failed",
    timestamp: new Date().toISOString(),
    outcome: "failure",
    ticketId: candidate.ticketId,
    settlementVersion: candidate.settlementVersion,
    activeSettlementVersion: candidate.activeSettlementVersion,
    matchStatus: candidate.matchStatus,
    reason,
  })}\n`);
}

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
        } catch (error) {
          failedTicketIds.push(candidate.ticketId);
          reportCandidateFailure(candidate, error);
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
      } catch (error) {
        // Operator-triggered, so the reason matters even more here: the caller
        // gets RETRY either way and cannot tell a transient write failure from a
        // ticket that will refuse every retry until someone decides something.
        reportCandidateFailure(candidate, error);
        return { outcome: "RETRY" as const, ticketId };
      }
    },
  };
}
