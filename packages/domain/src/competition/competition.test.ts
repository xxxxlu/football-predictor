import { describe, expect, it } from "vitest";
import { assessMarketData, createMatchView } from "./index.js";

const odds = {
  productMarketId: "fixture-1:bookmaker:8:market:1",
  fixtureId: "fixture-1",
  supplier: "API_FOOTBALL" as const,
  supplierFixtureId: 101,
  bookmakerId: 8,
  bookmakerName: "Bookmaker",
  marketId: 1,
  marketName: "Match Winner",
  version: "odds-v1",
  dataAsOf: "2026-07-13T10:00:00.000Z",
  capturedAt: "2026-07-13T10:00:30.000Z",
  outcomes: [
    { selection: "HOME" as const, supplierLabel: "Home", decimalOdds: "2.10" },
    { selection: "DRAW" as const, supplierLabel: "Draw", decimalOdds: "3.20" },
    { selection: "AWAY" as const, supplierLabel: "Away", decimalOdds: "3.40" },
  ],
};

describe("market data assessment", () => {
  it("keeps a verified odds snapshot open through exactly ten minutes", () => {
    expect(
      assessMarketData({
        now: new Date("2026-07-13T10:10:00.000Z"),
        odds,
        syncState: "IDLE",
        sourceVerified: true,
        budgetAvailable: true,
      }),
    ).toEqual({ dataState: "FRESH", marketStatus: "OPEN", canSubmit: true });
  });

  it("closes a market when odds are older than ten minutes", () => {
    expect(
      assessMarketData({
        now: new Date("2026-07-13T10:10:00.001Z"),
        odds,
        syncState: "IDLE",
        sourceVerified: true,
        budgetAvailable: true,
      }),
    ).toEqual({ dataState: "STALE", marketStatus: "DATA_UNAVAILABLE", canSubmit: false });
  });

  it("distinguishes syncing, paused and unverifiable data while rejecting submission", () => {
    expect(assessMarketData({ now: new Date(), odds, syncState: "SYNCING", sourceVerified: true, budgetAvailable: true }).dataState).toBe("SYNCING");
    expect(assessMarketData({ now: new Date(), odds, syncState: "PAUSED", sourceVerified: true, budgetAvailable: false }).dataState).toBe("PAUSED");
    expect(assessMarketData({ now: new Date(), odds, syncState: "IDLE", sourceVerified: false, budgetAvailable: true }).dataState).toBe("UNAVAILABLE");
  });
});

describe("match view", () => {
  it("uses the authoritative UTC kickoff and exposes supplier traceability", () => {
    const view = createMatchView({
      now: new Date("2026-07-13T10:05:00.000Z"),
      fixture: {
        id: "fixture-1",
        supplier: "API_FOOTBALL",
        supplierFixtureId: 101,
        competitionId: 1,
        competitionName: "World Cup",
        season: 2026,
        kickoffAt: "2026-07-13T12:00:00.000Z",
        status: "SCHEDULED",
        homeTeam: { supplierTeamId: 1, name: "Home" },
        awayTeam: { supplierTeamId: 2, name: "Away" },
        version: "fixture-v1",
        dataAsOf: "2026-07-13T09:00:00.000Z",
        capturedAt: "2026-07-13T09:00:01.000Z",
      },
      odds,
      syncState: "IDLE",
      sourceVerified: true,
      budgetAvailable: true,
    });

    expect(view.kickoffAt).toBe("2026-07-13T12:00:00.000Z");
    expect(view.market.trace).toMatchObject({ supplier: "API_FOOTBALL", bookmakerId: 8, supplierFixtureId: 101 });
    expect(view.market.id).toBe("fixture-1:bookmaker:8:market:1");
    expect(view.capabilities).toEqual({ prematchPrediction: true, livePrediction: false });
  });
});
