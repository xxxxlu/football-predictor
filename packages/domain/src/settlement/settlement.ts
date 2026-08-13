export type MatchSettlementStatus = "FINAL" | "CANCELLED" | "POSTPONED" | "SUSPENDED" | "SCHEDULED" | "LIVE";
export type SettlementOutcome = "WIN" | "LOSS" | "PUSH" | "CANCEL";
export type SettlementOperation = "SETTLE" | "REVERSAL";

export type SettlementErrorCode =
  | "TICKET_NOT_FOUND"
  | "INVALID_ODDS"
  | "INVALID_RESULT"
  | "INSUFFICIENT_FROZEN"
  | "SETTLEMENT_CONFLICT";

export class SettlementError extends Error {
  constructor(readonly code: SettlementErrorCode) {
    super(code);
    this.name = "SettlementError";
  }
}

export interface SettlementScope {
  ticketId: string;
  settlementVersion: string;
  operation: SettlementOperation;
}

export interface SettlementRecord {
  id: string;
  ticketId: string;
  settlementVersion: string;
  outcome: SettlementOutcome;
  grossReturnPoints: number;
  availableDeltaPoints: number;
  frozenDeltaPoints: number;
  correctionDebtDeltaPoints: number;
  ledgerId: string;
  settledAt: string;
}

export interface SettlementState {
  ticket: {
    id: string;
    userId: string;
    roomId: string;
    stakePoints: number;
    decimalOdds: string;
  };
  account: {
    availablePoints: number;
    frozenPoints: number;
    correctionDebtPoints: number;
  };
  activeSettlement: SettlementRecord | null;
}

export type ImmutableSettlementLedger = {
  id: string;
  type: "SETTLEMENT" | "SETTLEMENT_REVERSAL";
  ticketId: string;
  settlementVersion: string;
  outcome: SettlementOutcome;
  availableDeltaPoints: number;
  frozenDeltaPoints: number;
  correctionDebtDeltaPoints: number;
  occurredAt: string;
  reversesLedgerId: string | null;
};

export type SettlementOperationReceipt =
  | {
      status: "SETTLED";
      ticketId: string;
      settlementVersion: string;
      outcome: SettlementOutcome;
      grossReturnPoints: number;
      ledgerId: string;
      settledAt: string;
    }
  | {
      status: "REVERSED";
      ticketId: string;
      settlementVersion: string;
      ledgerId: string;
      reversedAt: string;
    };

export interface SettlementWrite {
  scope: SettlementScope & { operation: "SETTLE" };
  record: SettlementRecord;
  balance: { availableDeltaPoints: number; frozenDeltaPoints: number; correctionDebtDeltaPoints: number };
  ledger: ImmutableSettlementLedger & { type: "SETTLEMENT" };
  receipt: Extract<SettlementOperationReceipt, { status: "SETTLED" }>;
}

export interface ReversalWrite {
  scope: SettlementScope & { operation: "REVERSAL" };
  balance: { availableDeltaPoints: number; frozenDeltaPoints: number; correctionDebtDeltaPoints: number };
  ledger: ImmutableSettlementLedger & { type: "SETTLEMENT_REVERSAL" };
  receipt: Extract<SettlementOperationReceipt, { status: "REVERSED" }>;
}

export interface SettlementTransaction {
  findOperation(scope: SettlementScope): Promise<SettlementOperationReceipt | null>;
  getState(ticketId: string): Promise<SettlementState | null>;
  /** Appends ledger and applies all balance/record mutations atomically. */
  persistSettlement(write: SettlementWrite): Promise<SettlementOperationReceipt>;
  /** Appends reversal ledger; historical settlement and ledger rows remain immutable. */
  persistReversal(write: ReversalWrite): Promise<SettlementOperationReceipt>;
}

export interface SettlementTransactionPort {
  /** Must serialize by ticket and enforce unique(ticketId, version, operation). */
  run<T>(scope: SettlementScope, work: (transaction: SettlementTransaction) => Promise<T>): Promise<T>;
}

export interface SettlementClock { now(): Date }
export interface SettlementIds { next(kind: "settlement" | "reversal" | "ledger"): string }

export type SettleTicketInput = {
  ticketId: string;
  settlementVersion: string;
  matchStatus: MatchSettlementStatus;
  resultConfirmed: boolean;
  outcome?: Exclude<SettlementOutcome, "CANCEL">;
};

export type CorrectTicketInput = Omit<SettleTicketInput, "settlementVersion"> & {
  previousSettlementVersion: string;
  settlementVersion: string;
};

export type HeldSettlement = { status: "HELD"; reason: "MATCH_NOT_SETTLEABLE" | "RESULT_UNCONFIRMED" };
export type SettleTicketResult = Extract<SettlementOperationReceipt, { status: "SETTLED" }> | HeldSettlement;

function resolveOutcome(input: SettleTicketInput): SettlementOutcome | HeldSettlement {
  if (input.matchStatus !== "FINAL" && input.matchStatus !== "CANCELLED") {
    return { status: "HELD", reason: "MATCH_NOT_SETTLEABLE" };
  }
  if (!input.resultConfirmed) return { status: "HELD", reason: "RESULT_UNCONFIRMED" };
  if (input.matchStatus === "CANCELLED") return "CANCEL";
  if (!input.outcome) throw new SettlementError("INVALID_RESULT");
  return input.outcome;
}

/** Multiplies integer points by decimal-string odds and rounds half up exactly once. */
export function calculateWinReturnPoints(stakePoints: number, decimalOdds: string): number {
  if (!Number.isSafeInteger(stakePoints) || stakePoints < 0 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(decimalOdds)) {
    throw new SettlementError("INVALID_ODDS");
  }
  const [integerPart = "0", fractionPart = ""] = decimalOdds.split(".");
  if (`${integerPart}${fractionPart}`.replace(/0/g, "").length === 0) throw new SettlementError("INVALID_ODDS");
  const denominator = 10n ** BigInt(fractionPart.length);
  const numerator = BigInt(`${integerPart}${fractionPart}`);
  const product = BigInt(stakePoints) * numerator;
  const quotient = product / denominator;
  const remainder = product % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new SettlementError("INVALID_ODDS");
  return Number(rounded);
}

function grossReturn(state: SettlementState, outcome: SettlementOutcome): number {
  if (outcome === "LOSS") return 0;
  if (outcome === "PUSH" || outcome === "CANCEL") return state.ticket.stakePoints;
  return calculateWinReturnPoints(state.ticket.stakePoints, state.ticket.decimalOdds);
}

export class SettlementService {
  private readonly transaction: SettlementTransactionPort;
  private readonly clock: SettlementClock;
  private readonly ids: SettlementIds;

  constructor(input: { transaction: SettlementTransactionPort; clock: SettlementClock; ids: SettlementIds }) {
    this.transaction = input.transaction;
    this.clock = input.clock;
    this.ids = input.ids;
  }

  async settle(input: SettleTicketInput): Promise<SettleTicketResult> {
    const resolved = resolveOutcome(input);
    if (typeof resolved !== "string") return resolved;
    return this.settleResolved(input.ticketId, input.settlementVersion, resolved);
  }

  private async settleResolved(ticketId: string, settlementVersion: string, outcome: SettlementOutcome): Promise<Extract<SettlementOperationReceipt, { status: "SETTLED" }>> {
    const scope = { ticketId, settlementVersion, operation: "SETTLE" as const };
    return this.transaction.run(scope, async (transaction) => {
      const replay = await transaction.findOperation(scope);
      const state = await transaction.getState(ticketId);
      if (!state) throw new SettlementError("TICKET_NOT_FOUND");
      if (replay) {
        if (replay.status !== "SETTLED") throw new SettlementError("SETTLEMENT_CONFLICT");
        /*
         * A stored receipt only stands in for this operation while its effects are
         * still the live ones. `settlementVersion` is a content hash of the
         * supplier's result (api-football/src/index.ts `versionOf`), with no
         * monotonic component — so a supplier that corrects a result and later
         * reverts it presents a version that was already settled once and has since
         * been reversed. Returning the old receipt there wrote nothing at all: the
         * reversal had already put the stake back into `frozen`, the ticket stayed
         * PENDING, and the sweep counted it PROCESSED. The stake stayed frozen with
         * no payout, forever, and every later sweep replayed the same no-op because
         * `active_settlement_id IS NULL` keeps the ticket in the candidate set.
         *
         * Refusing is not the whole repair — re-applying this version needs a
         * ledger idempotency key that can distinguish a second attempt from the
         * first, which is a schema decision — but it turns a silent, permanent
         * freeze into a failure the sweep reports and an operator can retry.
         */
        if (state.activeSettlement?.settlementVersion !== settlementVersion) {
          throw new SettlementError("SETTLEMENT_CONFLICT");
        }
        return replay;
      }
      if (state.activeSettlement !== null) throw new SettlementError("SETTLEMENT_CONFLICT");
      if (!Number.isSafeInteger(state.ticket.stakePoints) || state.ticket.stakePoints <= 0 || state.account.frozenPoints < state.ticket.stakePoints) {
        throw new SettlementError("INSUFFICIENT_FROZEN");
      }

      const grossReturnPoints = grossReturn(state, outcome);
      const debtReduction = Math.min(state.account.correctionDebtPoints, grossReturnPoints);
      const availableDeltaPoints = grossReturnPoints - debtReduction;
      const frozenDeltaPoints = -state.ticket.stakePoints;
      const correctionDebtDeltaPoints = -debtReduction;
      const settledAt = this.clock.now().toISOString();
      const ledgerId = this.ids.next("ledger");
      const record: SettlementRecord = {
        id: this.ids.next("settlement"),
        ticketId,
        settlementVersion,
        outcome,
        grossReturnPoints,
        availableDeltaPoints,
        frozenDeltaPoints,
        correctionDebtDeltaPoints,
        ledgerId,
        settledAt,
      };
      const receipt: Extract<SettlementOperationReceipt, { status: "SETTLED" }> = {
        status: "SETTLED",
        ticketId,
        settlementVersion,
        outcome,
        grossReturnPoints,
        ledgerId,
        settledAt,
      };
      const persisted = await transaction.persistSettlement({
        scope,
        record,
        balance: { availableDeltaPoints, frozenDeltaPoints, correctionDebtDeltaPoints },
        ledger: {
          id: ledgerId,
          type: "SETTLEMENT",
          ticketId,
          settlementVersion,
          outcome,
          availableDeltaPoints,
          frozenDeltaPoints,
          correctionDebtDeltaPoints,
          occurredAt: settledAt,
          reversesLedgerId: null,
        },
        receipt,
      });
      if (persisted.status !== "SETTLED") throw new SettlementError("SETTLEMENT_CONFLICT");
      return persisted;
    });
  }

  private async reverse(ticketId: string, settlementVersion: string): Promise<Extract<SettlementOperationReceipt, { status: "REVERSED" }>> {
    const scope = { ticketId, settlementVersion, operation: "REVERSAL" as const };
    return this.transaction.run(scope, async (transaction) => {
      const replay = await transaction.findOperation(scope);
      if (replay) {
        if (replay.status !== "REVERSED") throw new SettlementError("SETTLEMENT_CONFLICT");
        return replay;
      }
      const state = await transaction.getState(ticketId);
      if (!state) throw new SettlementError("TICKET_NOT_FOUND");
      const original = state.activeSettlement;
      if (!original || original.settlementVersion !== settlementVersion) throw new SettlementError("SETTLEMENT_CONFLICT");

      const availableReclaimed = Math.min(state.account.availablePoints, original.availableDeltaPoints);
      const unrecoveredAvailable = original.availableDeltaPoints - availableReclaimed;
      const availableDeltaPoints = -availableReclaimed;
      const frozenDeltaPoints = -original.frozenDeltaPoints;
      const correctionDebtDeltaPoints = -original.correctionDebtDeltaPoints + unrecoveredAvailable;
      const reversedAt = this.clock.now().toISOString();
      const ledgerId = this.ids.next("ledger");
      const receipt: Extract<SettlementOperationReceipt, { status: "REVERSED" }> = {
        status: "REVERSED",
        ticketId,
        settlementVersion,
        ledgerId,
        reversedAt,
      };
      const persisted = await transaction.persistReversal({
        scope,
        balance: { availableDeltaPoints, frozenDeltaPoints, correctionDebtDeltaPoints },
        ledger: {
          id: ledgerId,
          type: "SETTLEMENT_REVERSAL",
          ticketId,
          settlementVersion,
          outcome: original.outcome,
          availableDeltaPoints,
          frozenDeltaPoints,
          correctionDebtDeltaPoints,
          occurredAt: reversedAt,
          reversesLedgerId: original.ledgerId,
        },
        receipt,
      });
      if (persisted.status !== "REVERSED") throw new SettlementError("SETTLEMENT_CONFLICT");
      return persisted;
    });
  }

  async correct(input: CorrectTicketInput): Promise<SettleTicketResult> {
    const settleInput: SettleTicketInput = {
      ticketId: input.ticketId,
      settlementVersion: input.settlementVersion,
      matchStatus: input.matchStatus,
      resultConfirmed: input.resultConfirmed,
      ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    };
    const resolved = resolveOutcome(settleInput);
    if (typeof resolved !== "string") return resolved;
    await this.reverse(input.ticketId, input.previousSettlementVersion);
    return this.settleResolved(input.ticketId, input.settlementVersion, resolved);
  }
}
