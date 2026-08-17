import { describe, expect, it } from "vitest";
import {
  SettlementError,
  SettlementService,
  type ImmutableSettlementLedger,
  type SettlementOperationReceipt,
  type SettlementState,
  type SettlementTransaction,
  type SettlementTransactionPort,
  type SettlementWrite,
  type ReversalWrite,
} from "./settlement.js";

const now = new Date("2026-07-13T14:00:00.000Z");

class SettlementFake implements SettlementTransactionPort {
  state: SettlementState = {
    ticket: { id: "ticket-1", userId: "user-1", roomId: "room-1", stakePoints: 1_000, decimalOdds: "2.10" },
    account: { availablePoints: 10_000, frozenPoints: 1_000, correctionDebtPoints: 0 },
    activeSettlement: null,
  };
  readonly operations = new Map<string, SettlementOperationReceipt>();
  readonly ledger: ImmutableSettlementLedger[] = [];
  failNextSettlement = false;
  private queue = Promise.resolve();

  async run<T>(_scope: { ticketId: string; settlementVersion: string; operation: "SETTLE" | "REVERSAL" }, work: (transaction: SettlementTransaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const transaction: SettlementTransaction = {
        findOperation: async (scope) => structuredClone(this.operations.get(`${scope.ticketId}:${scope.settlementVersion}:${scope.operation}`) ?? null),
        getState: async () => structuredClone(this.state),
        persistSettlement: async (write) => this.persistSettlement(write),
        persistReversal: async (write) => this.persistReversal(write),
      };
      return await work(transaction);
    } finally {
      release();
    }
  }

  spend(points: number) {
    this.state.account.availablePoints -= points;
  }

  private persistSettlement(write: SettlementWrite): SettlementOperationReceipt {
    if (this.failNextSettlement) {
      this.failNextSettlement = false;
      throw new Error("transient write failure");
    }
    const key = `${write.scope.ticketId}:${write.scope.settlementVersion}:${write.scope.operation}`;
    const existing = this.operations.get(key);
    if (existing) return structuredClone(existing);
    if (this.state.activeSettlement !== null) throw new SettlementError("SETTLEMENT_CONFLICT");
    this.state.account.availablePoints += write.balance.availableDeltaPoints;
    this.state.account.frozenPoints += write.balance.frozenDeltaPoints;
    this.state.account.correctionDebtPoints += write.balance.correctionDebtDeltaPoints;
    this.state.activeSettlement = structuredClone(write.record);
    this.ledger.push(structuredClone(write.ledger));
    this.operations.set(key, structuredClone(write.receipt));
    return structuredClone(write.receipt);
  }

  private persistReversal(write: ReversalWrite): SettlementOperationReceipt {
    const key = `${write.scope.ticketId}:${write.scope.settlementVersion}:${write.scope.operation}`;
    const existing = this.operations.get(key);
    if (existing) return structuredClone(existing);
    if (this.state.activeSettlement?.settlementVersion !== write.scope.settlementVersion) throw new SettlementError("SETTLEMENT_CONFLICT");
    this.state.account.availablePoints += write.balance.availableDeltaPoints;
    this.state.account.frozenPoints += write.balance.frozenDeltaPoints;
    this.state.account.correctionDebtPoints += write.balance.correctionDebtDeltaPoints;
    this.state.activeSettlement = null;
    this.ledger.push(structuredClone(write.ledger));
    this.operations.set(key, structuredClone(write.receipt));
    return structuredClone(write.receipt);
  }
}

function setup(fake = new SettlementFake()) {
  let id = 0;
  const service = new SettlementService({ transaction: fake, clock: { now: () => now }, ids: { next: (kind) => `${kind}-${++id}` } });
  return { fake, service };
}

describe("settlement eligibility and rules", () => {
  it.each(["POSTPONED", "SUSPENDED", "SCHEDULED", "LIVE"] as const)("keeps points frozen for %s", async (matchStatus) => {
    const { service, fake } = setup();
    const result = await service.settle({ ticketId: "ticket-1", settlementVersion: "v1", matchStatus, resultConfirmed: true, outcome: "WIN" });
    expect(result).toEqual({ status: "HELD", reason: "MATCH_NOT_SETTLEABLE" });
    expect(fake.state.account).toMatchObject({ availablePoints: 10_000, frozenPoints: 1_000 });
    expect(fake.ledger).toHaveLength(0);
  });

  it("keeps points frozen while the final result is unconfirmed", async () => {
    const { service, fake } = setup();
    await expect(service.settle({ ticketId: "ticket-1", settlementVersion: "v1", matchStatus: "FINAL", resultConfirmed: false, outcome: "WIN" })).resolves.toEqual({ status: "HELD", reason: "RESULT_UNCONFIRMED" });
    expect(fake.state.account.frozenPoints).toBe(1_000);
  });

  it("settles WIN with one exact round-half-up operation", async () => {
    const { service, fake } = setup();
    fake.state.ticket.stakePoints = 101;
    fake.state.ticket.decimalOdds = "1.005";
    fake.state.account.frozenPoints = 101;

    const result = await service.settle({ ticketId: "ticket-1", settlementVersion: "v1", matchStatus: "FINAL", resultConfirmed: true, outcome: "WIN" });

    expect(result).toMatchObject({ status: "SETTLED", outcome: "WIN", grossReturnPoints: 102 });
    expect(fake.state.account).toMatchObject({ availablePoints: 10_102, frozenPoints: 0 });
  });

  it.each([
    ["LOSS", 0],
    ["PUSH", 1_000],
  ] as const)("applies %s return rule", async (outcome, expectedReturn) => {
    const { service, fake } = setup();
    const result = await service.settle({ ticketId: "ticket-1", settlementVersion: "v1", matchStatus: "FINAL", resultConfirmed: true, outcome });
    expect(result).toMatchObject({ status: "SETTLED", outcome, grossReturnPoints: expectedReturn });
    expect(fake.state.account).toMatchObject({ availablePoints: 10_000 + expectedReturn, frozenPoints: 0 });
  });

  it("refunds the stake for a confirmed CANCELLED match", async () => {
    const { service, fake } = setup();
    const result = await service.settle({ ticketId: "ticket-1", settlementVersion: "v1", matchStatus: "CANCELLED", resultConfirmed: true });
    expect(result).toMatchObject({ status: "SETTLED", outcome: "CANCEL", grossReturnPoints: 1_000 });
    expect(fake.state.account).toMatchObject({ availablePoints: 11_000, frozenPoints: 0 });
  });

  it("uses a return to reduce correction debt before crediting available points", async () => {
    const { service, fake } = setup();
    fake.state.account.availablePoints = 0;
    fake.state.account.correctionDebtPoints = 500;
    fake.state.ticket.decimalOdds = "2.00";

    await service.settle({ ticketId: "ticket-1", settlementVersion: "v1", matchStatus: "FINAL", resultConfirmed: true, outcome: "WIN" });

    expect(fake.state.account).toEqual({ availablePoints: 1_500, frozenPoints: 0, correctionDebtPoints: 0 });
    expect(fake.ledger[0]).toMatchObject({ availableDeltaPoints: 1_500, frozenDeltaPoints: -1_000, correctionDebtDeltaPoints: -500 });
  });
});

describe("settlement idempotency, retry and correction", () => {
  it("replays ticketId + version + operation without duplicate ledger entries", async () => {
    const { service, fake } = setup();
    const input = { ticketId: "ticket-1", settlementVersion: "v1", matchStatus: "FINAL" as const, resultConfirmed: true, outcome: "WIN" as const };
    const first = await service.settle(input);
    const replay = await service.settle(input);
    expect(replay).toEqual(first);
    expect(fake.ledger).toHaveLength(1);
  });

  /*
   * `settlementVersion` is a content hash of the supplier's result, so a result
   * that is corrected and then reverted presents a version that was already
   * settled and has since been reversed. The stored receipt must not stand in for
   * the settlement in that state: doing so wrote nothing, left the reversal's
   * re-frozen stake in place with no payout, and reported success — every sweep,
   * forever, because the ticket stays a candidate while it has no active
   * settlement.
   */
  it("refuses a stored receipt whose settlement was since reversed", async () => {
    const { service, fake } = setup();
    const settled = { ticketId: "ticket-1", matchStatus: "FINAL" as const, resultConfirmed: true };
    await service.settle({ ...settled, settlementVersion: "hash-of-2-1", outcome: "WIN" });
    await service.correct({ ...settled, previousSettlementVersion: "hash-of-2-1", settlementVersion: "hash-of-3-1", outcome: "LOSS" });

    // The supplier reverts to the first result, so the hash is the first one again.
    await expect(service.correct({ ...settled, previousSettlementVersion: "hash-of-3-1", settlementVersion: "hash-of-2-1", outcome: "WIN" }))
      .rejects.toBeInstanceOf(SettlementError);

    // The refusal is loud rather than silent, but the stake is still sitting in
    // frozen where the reversal put it — the repair belongs to the caller/operator.
    expect(fake.state.activeSettlement).toBeNull();
    expect(fake.state.account.frozenPoints).toBe(1_000);
  });

  it("can retry safely after a transient persistence failure", async () => {
    const { service, fake } = setup();
    fake.failNextSettlement = true;
    const input = { ticketId: "ticket-1", settlementVersion: "v1", matchStatus: "FINAL" as const, resultConfirmed: true, outcome: "PUSH" as const };
    await expect(service.settle(input)).rejects.toThrow("transient write failure");
    await expect(service.settle(input)).resolves.toMatchObject({ status: "SETTLED", outcome: "PUSH" });
    expect(fake.ledger).toHaveLength(1);
  });

  it("corrects by appending reversal before the new settlement", async () => {
    const { service, fake } = setup();
    await service.settle({ ticketId: "ticket-1", settlementVersion: "v1", matchStatus: "FINAL", resultConfirmed: true, outcome: "WIN" });

    await service.correct({ ticketId: "ticket-1", previousSettlementVersion: "v1", settlementVersion: "v2", matchStatus: "FINAL", resultConfirmed: true, outcome: "LOSS" });

    expect(fake.ledger.map((entry) => entry.type)).toEqual(["SETTLEMENT", "SETTLEMENT_REVERSAL", "SETTLEMENT"]);
    expect(fake.state.account).toEqual({ availablePoints: 10_000, frozenPoints: 0, correctionDebtPoints: 0 });
    expect(fake.state.activeSettlement).toMatchObject({ settlementVersion: "v2", outcome: "LOSS" });
  });

  it("creates correction debt when reversal exceeds available and preserves unrelated frozen points", async () => {
    const { service, fake } = setup();
    fake.state.account.availablePoints = 0;
    fake.state.account.frozenPoints = 1_500;
    fake.state.ticket.decimalOdds = "2.00";
    await service.settle({ ticketId: "ticket-1", settlementVersion: "v1", matchStatus: "FINAL", resultConfirmed: true, outcome: "WIN" });
    fake.spend(1_900);

    await service.correct({ ticketId: "ticket-1", previousSettlementVersion: "v1", settlementVersion: "v2", matchStatus: "FINAL", resultConfirmed: true, outcome: "LOSS" });

    expect(fake.state.account).toEqual({ availablePoints: 0, frozenPoints: 500, correctionDebtPoints: 1_900 });
    expect(fake.ledger[1]).toMatchObject({ type: "SETTLEMENT_REVERSAL", availableDeltaPoints: -100, correctionDebtDeltaPoints: 1_900, frozenDeltaPoints: 1_000 });
  });
});
