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
      persistFreeze: async (write) => {
        this.account.availablePoints += write.balance.availableDeltaPoints;
        this.account.frozenPoints += write.balance.frozenDeltaPoints;
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

  it("gates EXACT_PODIUM behind ADVANCED rooms without touching the correct-score path", async () => {
    const outcomes = [{ selection: "POD3:NOR-VER-PIA", decimalOdds: "18.00" }];
    const command = {
      userId: "user-1",
      roomId: "room-1",
      idempotencyKey: "idem-f1-2",
      marketId: "f1:session-9:EXACT_PODIUM",
      selection: "POD3:NOR-VER-PIA" as const,
      stakePoints: 200,
      acceptedOddsVersion: "f1-odds-v1",
      acceptedDecimalOdds: "18.00",
    };

    const standard = setup(f1Market("EXACT_PODIUM", outcomes));
    await expect(standard.service.submit(command)).rejects.toMatchObject({
      name: "TicketSubmissionError",
      code: "ADVANCED_ROOM_REQUIRED",
    });
    expect(standard.fake.writes).toHaveLength(0);

    const advanced = setup(f1Market("EXACT_PODIUM", outcomes));
    advanced.fake.tier = "ADVANCED";
    const ticket = await advanced.service.submit(command);
    expect(ticket.legs[0]?.oddsSnapshot.marketId).toBe(104);
    /* The football single-open-score-ticket rule must not apply to F1 exact podium. */
    expect(advanced.fake.correctScoreTierReads).toBe(0);
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
