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
} from "../predictions/ticket-submission.js";
import type { RoomSport, RoomTier } from "../rooms/service.js";
import { F1_SUPPLIER, F1_SUPPLIER_MARKET_IDS, f1FixtureId, f1MarketId } from "./markets.js";

const serverTime = new Date("2026-07-13T10:00:00.000Z");

function f1Market(kind: keyof typeof F1_SUPPLIER_MARKET_IDS, outcomes: Array<{ selection: string; decimalOdds: string }>): MarketForSubmission {
  return {
    id: f1MarketId("session-9", kind),
    fixtureId: f1FixtureId("session-9"),
    status: "OPEN",
    kickoffAt: "2026-07-13T14:00:00.000Z",
    snapshot: {
      version: "f1-odds-v1",
      dataAsOf: "2026-07-13T09:00:00.000Z",
      supplier: F1_SUPPLIER,
      supplierFixtureId: 0,
      bookmakerId: 0,
      marketId: F1_SUPPLIER_MARKET_IDS[kind],
      outcomes: outcomes as MarketForSubmission["snapshot"]["outcomes"],
      sourceVerified: true,
    },
  };
}

class AtomicFake implements TicketSubmissionTransactionPort {
  readonly tickets = new Map<string, SubmittedTicket>();
  readonly writes: AtomicFreezeWrite[] = [];
  account: PointsAccount = { userId: "user-1", roomId: "room-1", availablePoints: 10_000, frozenPoints: 0 };
  market: MarketForSubmission | null = null;
  tier: RoomTier = "STANDARD";
  sport: RoomSport = "FORMULA_1";
  correctScoreTierReads = 0;
  readonly openMarkets = new Set<string>();

  async run<T>(_scope: { userId: string; roomId: string; idempotencyKey: string }, work: (transaction: TicketSubmissionTransaction) => Promise<T>): Promise<T> {
    const transaction: TicketSubmissionTransaction = {
      findByIdempotencyKey: async (scope) => this.tickets.get(`${scope.userId}:${scope.roomId}:${scope.idempotencyKey}`) ?? null,
      getPointsAccount: async () => structuredClone(this.account),
      getMarket: async () => structuredClone(this.market),
      getRoomTier: async () => this.tier,
      getRoomSport: async () => this.sport,
      hasOpenCorrectScoreTicket: async () => {
        this.correctScoreTierReads += 1;
        return false;
      },
      hasOpenTicketForMarket: async (userId, roomId, marketId) => this.openMarkets.has(`${userId}:${roomId}:${marketId}`),
      persistFreeze: async (write) => {
        this.account.availablePoints += write.balance.availableDeltaPoints;
        this.account.frozenPoints += write.balance.frozenDeltaPoints;
        this.openMarkets.add(`${write.ticket.userId}:${write.ticket.roomId}:${write.ticket.marketId}`);
        this.tickets.set(`${write.ticket.userId}:${write.ticket.roomId}:${write.ticket.idempotencyKey}`, structuredClone(write.ticket));
        this.writes.push(structuredClone(write));
        return structuredClone(write.ticket);
      },
    };
    return work(transaction);
  }
}

function setup(market: MarketForSubmission) {
  const fake = new AtomicFake();
  fake.market = market;
  let id = 0;
  const service = new TicketSubmissionService({
    transaction: fake,
    clock: { now: () => serverTime },
    ids: { next: (kind) => `${kind}-${++id}` },
  });
  return { fake, service };
}

describe("TicketSubmissionService F1 markets", () => {
  it("freezes an F1 winner ticket in a STANDARD room with the full odds provenance snapshot", async () => {
    const { fake, service } = setup(f1Market("WINNER", [
      { selection: "DRV:NOR", decimalOdds: "2.40" },
      { selection: "DRV:VER", decimalOdds: "3.10" },
    ]));

    const ticket = await service.submit({
      userId: "user-1",
      roomId: "room-1",
      idempotencyKey: "idem-f1-1",
      marketId: "f1:session-9:WINNER",
      selection: "DRV:NOR",
      stakePoints: 500,
      acceptedOddsVersion: "f1-odds-v1",
      acceptedDecimalOdds: "2.40",
    });

    expect(ticket.status).toBe("PENDING");
    expect(ticket.fixtureId).toBe("f1:session-9");
    expect(ticket.legs).toHaveLength(1);
    expect(ticket.legs[0]?.oddsSnapshot).toMatchObject({
      supplier: "F1_MANUAL",
      supplierFixtureId: 0,
      bookmakerId: 0,
      marketId: 102,
      decimalOdds: "2.40",
      version: "f1-odds-v1",
    });
    expect(fake.account).toMatchObject({ availablePoints: 9_500, frozenPoints: 500 });
    expect(fake.writes[0]?.ledger).toMatchObject({ type: "PREDICTION_FREEZE", availableDeltaPoints: -500, frozenDeltaPoints: 500 });
  });

  it("accepts EXACT_PODIUM in a STANDARD room via legacy enumerated combo outcomes", async () => {
    /* 2026-07-25: the advanced-room gate was removed when 领奖台之争 became the one
       podium market — every room tier can stake it. */
    const outcomes = [{ selection: "POD3:NOR-VER-PIA", decimalOdds: "18.00" }];
    const { fake, service } = setup(f1Market("EXACT_PODIUM", outcomes));
    const ticket = await service.submit({
      userId: "user-1",
      roomId: "room-1",
      idempotencyKey: "idem-f1-2",
      marketId: "f1:session-9:EXACT_PODIUM",
      selection: "POD3:NOR-VER-PIA",
      stakePoints: 200,
      acceptedOddsVersion: "f1-odds-v1",
      acceptedDecimalOdds: "18.00",
    });
    expect(ticket.legs[0]?.oddsSnapshot.marketId).toBe(104);
    /* The football single-open-score-ticket rule must not apply to F1 exact podium. */
    expect(fake.correctScoreTierReads).toBe(0);
  });

  it("derives EXACT_PODIUM combo odds from per-driver base outcomes", async () => {
    const { service } = setup(f1Market("EXACT_PODIUM", [
      { selection: "DRV:NOR", decimalOdds: "5.00" },
      { selection: "DRV:VER", decimalOdds: "6.00" },
      { selection: "DRV:PIA", decimalOdds: "8.00" },
    ]));
    const command = {
      userId: "user-1",
      roomId: "room-1",
      idempotencyKey: "idem-f1-derived",
      marketId: "f1:session-9:EXACT_PODIUM",
      selection: "POD3:NOR-VER-PIA" as const,
      stakePoints: 200,
      acceptedOddsVersion: "f1-odds-v1",
      // 5.00 × 6.00 × 8.00 / 2.5 = 96.00 (shared exactPodiumComboOdds formula)
      acceptedDecimalOdds: "96.00",
    };
    const ticket = await service.submit(command);
    expect(ticket.legs[0]?.oddsSnapshot).toMatchObject({ marketId: 104, decimalOdds: "96.00" });

    /* A stale accepted price on the derived path still surfaces as ODDS_CHANGED. */
    const stale = setup(f1Market("EXACT_PODIUM", [
      { selection: "DRV:NOR", decimalOdds: "5.00" },
      { selection: "DRV:VER", decimalOdds: "6.00" },
      { selection: "DRV:PIA", decimalOdds: "8.00" },
    ]));
    await expect(stale.service.submit({ ...command, acceptedDecimalOdds: "95.00" }))
      .rejects.toMatchObject({ code: "ODDS_CHANGED" });
  });

  it("rejects a bare DRV base-outcome selection on the EXACT_PODIUM market", async () => {
    /* Base outcomes are pricing inputs, not bettable selections — without the grammar
       guard the direct outcome match would accept them at field odds. */
    const { fake, service } = setup(f1Market("EXACT_PODIUM", [
      { selection: "DRV:NOR", decimalOdds: "5.00" },
      { selection: "DRV:VER", decimalOdds: "6.00" },
      { selection: "DRV:PIA", decimalOdds: "8.00" },
    ]));
    await expect(service.submit({
      userId: "user-1",
      roomId: "room-1",
      idempotencyKey: "idem-f1-base",
      marketId: "f1:session-9:EXACT_PODIUM",
      selection: "DRV:NOR",
      stakePoints: 100,
      acceptedOddsVersion: "f1-odds-v1",
      acceptedDecimalOdds: "5.00",
    })).rejects.toMatchObject({ name: "TicketSubmissionError", code: "DATA_UNAVAILABLE" });
    expect(fake.writes).toHaveLength(0);
  });

  it("enforces 一人一注: one open ticket per F1 market, while idempotent replays still return the original", async () => {
    const { fake, service } = setup(f1Market("WINNER", [
      { selection: "DRV:NOR", decimalOdds: "2.40" },
      { selection: "DRV:VER", decimalOdds: "3.10" },
    ]));
    const command = {
      userId: "user-1",
      roomId: "room-1",
      idempotencyKey: "idem-once-1",
      marketId: "f1:session-9:WINNER",
      selection: "DRV:NOR" as const,
      stakePoints: 300,
      acceptedOddsVersion: "f1-odds-v1",
      acceptedDecimalOdds: "2.40",
    };
    const first = await service.submit(command);

    /* Same idempotency key → the stored ticket replays, no double freeze. */
    await expect(service.submit(command)).resolves.toMatchObject({ id: first.id });
    expect(fake.writes).toHaveLength(1);

    /* A genuinely new submission on the same market — even a different outcome —
       is refused without freezing points. */
    await expect(service.submit({ ...command, idempotencyKey: "idem-once-2", selection: "DRV:VER", acceptedDecimalOdds: "3.10" }))
      .rejects.toMatchObject({ name: "TicketSubmissionError", code: "MARKET_TICKET_EXISTS" });
    expect(fake.writes).toHaveLength(1);
    expect(fake.account).toMatchObject({ availablePoints: 9_700, frozenPoints: 300 });
  });

  it("does not gate the other F1 kinds behind room tier", async () => {
    for (const [kind, selection, odds] of [
      ["POLE", "DRV:VER", "2.80"],
      ["PODIUM", "PODIUM:HAM:YES", "1.95"],
      ["H2H", "H2H:NOR>VER", "1.88"],
    ] as const) {
      const { service } = setup(f1Market(kind, [{ selection, decimalOdds: odds }]));
      await expect(service.submit({
        userId: "user-1",
        roomId: "room-1",
        idempotencyKey: `idem-${kind}`,
        marketId: `f1:session-9:${kind}`,
        selection,
        stakePoints: 100,
        acceptedOddsVersion: "f1-odds-v1",
        acceptedDecimalOdds: odds,
      })).resolves.toMatchObject({ status: "PENDING" });
    }
  });

  it("rejects an F1 ticket in a football room without freezing points", async () => {
    const { fake, service } = setup(f1Market("WINNER", [{ selection: "DRV:NOR", decimalOdds: "2.40" }]));
    fake.sport = "FOOTBALL";
    await expect(service.submit({
      userId: "user-1",
      roomId: "room-1",
      idempotencyKey: "idem-f1-sport",
      marketId: "f1:session-9:WINNER",
      selection: "DRV:NOR",
      stakePoints: 100,
      acceptedOddsVersion: "f1-odds-v1",
      acceptedDecimalOdds: "2.40",
    })).rejects.toMatchObject({ name: "TicketSubmissionError", code: "ROOM_SPORT_MISMATCH" });
    expect(fake.writes).toHaveLength(0);
    expect(fake.account).toMatchObject({ availablePoints: 10_000, frozenPoints: 0 });
  });

  it("still rejects stale odds versions on F1 markets", async () => {
    const { service } = setup(f1Market("WINNER", [{ selection: "DRV:NOR", decimalOdds: "2.40" }]));
    await expect(service.submit({
      userId: "user-1",
      roomId: "room-1",
      idempotencyKey: "idem-f1-3",
      marketId: "f1:session-9:WINNER",
      selection: "DRV:NOR",
      stakePoints: 100,
      acceptedOddsVersion: "f1-odds-v0",
      acceptedDecimalOdds: "2.40",
    })).rejects.toMatchObject({ code: "ODDS_CHANGED" });
  });
});
