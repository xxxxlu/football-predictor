import { describe, expect, it } from "vitest";
import {
  TicketSubmissionError,
  TicketSubmissionService,
  type AtomicFreezeWrite,
  type MarketForSubmission,
  type PointsAccount,
  type SubmittedTicket,
  type TicketSubmissionTransaction,
  type TicketSubmissionTransactionPort,
} from "./ticket-submission.js";

const serverTime = new Date("2026-07-13T10:00:00.000Z");
const defaultMarket: MarketForSubmission = {
  id: "market-1",
  fixtureId: "fixture-1",
  status: "OPEN",
  kickoffAt: "2026-07-13T12:00:00.000Z",
  snapshot: {
    version: "odds-v2",
    dataAsOf: "2026-07-13T09:50:00.000Z",
    supplier: "API_FOOTBALL",
    supplierFixtureId: 101,
    bookmakerId: 8,
    marketId: 1,
    outcomes: [
      { selection: "HOME", decimalOdds: "2.10" },
      { selection: "DRAW", decimalOdds: "3.20" },
      { selection: "AWAY", decimalOdds: "3.40" },
    ],
    sourceVerified: true,
  },
};

class AtomicFake implements TicketSubmissionTransactionPort {
  readonly tickets = new Map<string, SubmittedTicket>();
  readonly writes: AtomicFreezeWrite[] = [];
  readonly ledgers: AtomicFreezeWrite["ledger"][] = [];
  account: PointsAccount = { userId: "user-1", roomId: "room-1", availablePoints: 10_000, frozenPoints: 0 };
  market: MarketForSubmission | null = structuredClone(defaultMarket);
  private queue: Promise<void> = Promise.resolve();

  async run<T>(_scope: { userId: string; roomId: string; idempotencyKey: string }, work: (transaction: TicketSubmissionTransaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const transaction: TicketSubmissionTransaction = {
        findByIdempotencyKey: async (scope) => this.tickets.get(`${scope.userId}:${scope.roomId}:${scope.idempotencyKey}`) ?? null,
        getPointsAccount: async () => structuredClone(this.account),
        getMarket: async () => structuredClone(this.market),
        persistFreeze: async (write) => {
          const key = `${write.ticket.userId}:${write.ticket.roomId}:${write.ticket.idempotencyKey}`;
          const existing = this.tickets.get(key);
          if (existing) return structuredClone(existing);
          if (this.account.availablePoints < write.balance.availableDeltaPoints * -1) {
            throw new TicketSubmissionError("INSUFFICIENT_POINTS");
          }
          this.account.availablePoints += write.balance.availableDeltaPoints;
          this.account.frozenPoints += write.balance.frozenDeltaPoints;
          this.tickets.set(key, structuredClone(write.ticket));
          this.writes.push(structuredClone(write));
          this.ledgers.push(structuredClone(write.ledger));
          return structuredClone(write.ticket);
        },
      };
      return await work(transaction);
    } finally {
      release();
    }
  }
}

function setup(fake = new AtomicFake()) {
  let id = 0;
  const service = new TicketSubmissionService({
    transaction: fake,
    clock: { now: () => serverTime },
    ids: { next: (kind) => `${kind}-${++id}` },
  });
  const command = {
    userId: "user-1",
    roomId: "room-1",
    marketId: "market-1",
    selection: "HOME" as const,
    stakePoints: 1_000,
    acceptedOddsVersion: "odds-v2",
    acceptedDecimalOdds: "2.10",
    idempotencyKey: "idem-1",
  };
  return { fake, service, command };
}

async function expectCode(promise: Promise<unknown>, code: TicketSubmissionError["code"]) {
  await expect(promise).rejects.toMatchObject({ name: "TicketSubmissionError", code });
}

describe("TicketSubmissionService validation", () => {
  it.each([0, -1, 20_001, 1.5, Number.NaN])("rejects invalid integer stake %s", async (stakePoints) => {
    const { service, command } = setup();
    await expectCode(service.submit({ ...command, stakePoints }), "INVALID_STAKE");
  });

  it("rejects stake above the available room balance", async () => {
    const { service, command, fake } = setup();
    fake.account.availablePoints = 999;
    await expectCode(service.submit(command), "INSUFFICIENT_POINTS");
  });

  it("rejects a non-open market and the exact kickoff boundary", async () => {
    const first = setup();
    first.fake.market!.status = "CLOSED";
    await expectCode(first.service.submit(first.command), "MARKET_CLOSED");

    const second = setup();
    second.fake.market!.kickoffAt = serverTime.toISOString();
    await expectCode(second.service.submit(second.command), "MARKET_CLOSED");
  });

  it("rejects stale, future, unverifiable or explicitly unavailable odds", async () => {
    for (const mutate of [
      (market: MarketForSubmission) => { market.snapshot.dataAsOf = "2026-07-13T09:49:59.999Z"; },
      (market: MarketForSubmission) => { market.snapshot.dataAsOf = "2026-07-13T10:00:00.001Z"; },
      (market: MarketForSubmission) => { market.snapshot.sourceVerified = false; },
      (market: MarketForSubmission) => { market.status = "DATA_UNAVAILABLE"; },
    ]) {
      const { service, command, fake } = setup();
      mutate(fake.market!);
      await expectCode(service.submit(command), "DATA_UNAVAILABLE");
    }
  });

  it("accepts an older verified platform-fixed multiplier before kickoff", async () => {
    const { service, command, fake } = setup();
    fake.market!.snapshot.supplier = "PLATFORM";
    fake.market!.snapshot.dataAsOf = "2026-07-01T00:00:00.000Z";

    await expect(service.submit(command)).resolves.toMatchObject({ status: "PENDING", stakePoints: 1_000 });
  });

  it("requires the accepted version and decimal odds string to match current odds", async () => {
    const first = setup();
    await expectCode(first.service.submit({ ...first.command, acceptedOddsVersion: "odds-v1" }), "ODDS_CHANGED");
    const second = setup();
    await expectCode(second.service.submit({ ...second.command, acceptedDecimalOdds: "2.1" }), "ODDS_CHANGED");
  });
});

describe("TicketSubmissionService atomic freeze", () => {
  it("atomically creates ticket, leg, snapshot, balance movement and ledger using integers", async () => {
    const { service, command, fake } = setup();

    const result = await service.submit(command);

    expect(result).toMatchObject({ userId: "user-1", roomId: "room-1", stakePoints: 1_000, status: "PENDING" });
    expect(result.legs).toEqual([{ selection: "HOME", oddsSnapshot: expect.objectContaining({ version: "odds-v2", decimalOdds: "2.10" }) }]);
    expect(fake.account).toMatchObject({ availablePoints: 9_000, frozenPoints: 1_000 });
    expect(fake.writes[0]?.balance).toEqual({ availableDeltaPoints: -1_000, frozenDeltaPoints: 1_000 });
    expect(fake.ledgers[0]).toMatchObject({ type: "PREDICTION_FREEZE", availableDeltaPoints: -1_000, frozenDeltaPoints: 1_000 });
  });

  it("returns the identical persisted ticket on an idempotency replay without another freeze", async () => {
    const { service, command, fake } = setup();
    const first = await service.submit(command);
    const replay = await service.submit(command);

    expect(replay).toEqual(first);
    expect(fake.writes).toHaveLength(1);
    expect(fake.account).toMatchObject({ availablePoints: 9_000, frozenPoints: 1_000 });
  });

  it("relies on transaction unique/serialization semantics under concurrent duplicate calls", async () => {
    const { service, command, fake } = setup();
    const [first, second] = await Promise.all([service.submit(command), service.submit(command)]);

    expect(second).toEqual(first);
    expect(fake.writes).toHaveLength(1);
    expect(fake.ledgers).toHaveLength(1);
  });

  it("prevents two distinct concurrent submissions from overspending one room account", async () => {
    const { service, command, fake } = setup();
    fake.account.availablePoints = 1_000;
    const results = await Promise.allSettled([
      service.submit(command),
      service.submit({ ...command, idempotencyKey: "idem-2" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(fake.account).toMatchObject({ availablePoints: 0, frozenPoints: 1_000 });
  });
});
