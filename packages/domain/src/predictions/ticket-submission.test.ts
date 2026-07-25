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
import { CORRECT_SCORE_SUPPLIER_MARKET_ID } from "./markets.js";
import type { RoomSport, RoomTier } from "../rooms/service.js";

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
  tier: RoomTier = "STANDARD";
  sport: RoomSport = "FOOTBALL";
  readonly openCorrectScore = new Set<string>();
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
        getRoomTier: async () => this.tier,
        getRoomSport: async () => this.sport,
        hasOpenCorrectScoreTicket: async (userId, roomId, fixtureId) => this.openCorrectScore.has(`${userId}:${roomId}:${fixtureId}`),
        // 一人一注 is an F1-only rule; the football fake never reports an open market.
        hasOpenTicketForMarket: async () => false,
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
          if (write.ticket.legs[0]?.oddsSnapshot.marketId === CORRECT_SCORE_SUPPLIER_MARKET_ID) {
            this.openCorrectScore.add(`${write.ticket.userId}:${write.ticket.roomId}:${write.ticket.fixtureId}`);
          }
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

  it("rejects future, invalid, unverifiable or explicitly unavailable odds", async () => {
    for (const mutate of [
      (market: MarketForSubmission) => { market.snapshot.dataAsOf = "2026-07-13T10:00:00.001Z"; },
      (market: MarketForSubmission) => { market.snapshot.dataAsOf = "not-a-date"; },
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

  it("accepts the last verified The Odds API snapshot until kickoff", async () => {
    const { service, command, fake } = setup();
    fake.market!.snapshot.supplier = "THE_ODDS_API";
    fake.market!.snapshot.dataAsOf = "2026-07-12T10:00:00.000Z";
    await expect(service.submit(command)).resolves.toMatchObject({ status: "PENDING" });
  });

  it("rejects a football ticket in an F1 room without freezing points", async () => {
    const { service, command, fake } = setup();
    fake.sport = "FORMULA_1";
    await expectCode(service.submit(command), "ROOM_SPORT_MISMATCH");
    expect(fake.writes).toHaveLength(0);
    expect(fake.account).toMatchObject({ availablePoints: 10_000, frozenPoints: 0 });
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

const correctScoreMarket: MarketForSubmission = {
  id: "market-cs-1",
  fixtureId: "fixture-1",
  status: "OPEN",
  kickoffAt: "2026-07-13T12:00:00.000Z",
  snapshot: {
    version: "cs-v1",
    dataAsOf: "2026-07-13T09:50:00.000Z",
    supplier: "PLATFORM",
    supplierFixtureId: 101,
    bookmakerId: 0,
    marketId: CORRECT_SCORE_SUPPLIER_MARKET_ID,
    outcomes: [
      { selection: "2-1", decimalOdds: "8.00" },
      { selection: "1-1", decimalOdds: "6.00" },
      { selection: "OTHER", decimalOdds: "5.00" },
    ],
    sourceVerified: true,
  },
};

function setupCorrectScore(tier: RoomTier = "ADVANCED") {
  const fake = new AtomicFake();
  fake.tier = tier;
  fake.market = structuredClone(correctScoreMarket);
  const { service, command } = setup(fake);
  return {
    fake,
    service,
    command: { ...command, marketId: "market-cs-1", selection: "2-1" as const, acceptedOddsVersion: "cs-v1", acceptedDecimalOdds: "8.00" },
  };
}

describe("TicketSubmissionService correct-score market", () => {
  it("accepts a correct-score submission in an advanced room and freezes the stake", async () => {
    const { service, command, fake } = setupCorrectScore();
    const result = await service.submit(command);
    expect(result).toMatchObject({ status: "PENDING", stakePoints: 1_000 });
    expect(result.legs[0]).toMatchObject({ selection: "2-1", oddsSnapshot: expect.objectContaining({ decimalOdds: "8.00", marketId: CORRECT_SCORE_SUPPLIER_MARKET_ID }) });
    expect(fake.account).toMatchObject({ availablePoints: 9_000, frozenPoints: 1_000 });
  });

  it("accepts the OTHER catch-all selection in an advanced room", async () => {
    const { service, command } = setupCorrectScore();
    const result = await service.submit({ ...command, selection: "OTHER", acceptedDecimalOdds: "5.00", idempotencyKey: "idem-other" });
    expect(result.legs[0]).toMatchObject({ selection: "OTHER" });
  });

  it("rejects a correct-score submission in a standard room", async () => {
    const { service, command, fake } = setupCorrectScore("STANDARD");
    await expectCode(service.submit(command), "ADVANCED_ROOM_REQUIRED");
    expect(fake.writes).toHaveLength(0);
    expect(fake.account).toMatchObject({ availablePoints: 10_000, frozenPoints: 0 });
  });

  it("rejects a second unsettled correct-score ticket on the same fixture", async () => {
    const { service, command } = setupCorrectScore();
    await service.submit(command);
    await expectCode(service.submit({ ...command, selection: "1-1", acceptedDecimalOdds: "6.00", idempotencyKey: "idem-2" }), "SCORE_TICKET_EXISTS");
  });

  it("replays an identical correct-score submission without a second freeze", async () => {
    const { service, command, fake } = setupCorrectScore();
    const first = await service.submit(command);
    const replay = await service.submit(command);
    expect(replay).toEqual(first);
    expect(fake.writes).toHaveLength(1);
  });

  it("requires the accepted correct-score odds version to match", async () => {
    const { service, command } = setupCorrectScore();
    await expectCode(service.submit({ ...command, acceptedOddsVersion: "cs-v0" }), "ODDS_CHANGED");
  });
});
