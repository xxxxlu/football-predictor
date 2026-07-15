import { describe, expect, it } from "vitest";
import { assessMarketData, createMatchView, localizeCompetitionName, localizeTeamName } from "./index.js";

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

describe("Chinese football names", () => {
  it("localizes supported competitions and World Cup national teams", () => {
    expect(localizeCompetitionName("FIFA World Cup")).toBe("世界杯");
    expect(localizeCompetitionName("UEFA Champions League")).toBe("欧冠");
    expect(localizeCompetitionName("Premier League")).toBe("英超");
    expect(localizeCompetitionName("La Liga")).toBe("西甲");
    expect(localizeTeamName("France", "FRA")).toBe("法国");
    expect(localizeTeamName("Spain", "ESP")).toBe("西班牙");
    expect(localizeTeamName("England", "ENG")).toBe("英格兰");
    expect(localizeTeamName("Argentina", "ARG")).toBe("阿根廷");
  });
});

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

  it("keeps an older verified snapshot open while marking its age transparently", () => {
    expect(
      assessMarketData({
        now: new Date("2026-07-13T10:10:00.001Z"),
        odds,
        syncState: "IDLE",
        sourceVerified: true,
        budgetAvailable: true,
      }),
    ).toEqual({ dataState: "STALE", marketStatus: "OPEN", canSubmit: true });
  });

  it("keeps a verified platform-fixed multiplier open because the rule does not expire every ten minutes", () => {
    expect(assessMarketData({
      now: new Date("2026-07-14T18:00:00.000Z"),
      odds: { ...odds, supplier: "PLATFORM", dataAsOf: "2026-07-14T10:00:00.000Z" },
      syncState: "IDLE", sourceVerified: true, budgetAvailable: true,
    })).toEqual({ dataState: "FRESH", marketStatus: "OPEN", canSubmit: true });
  });

  it("keeps the last verified The Odds API snapshot usable beyond three hours", () => {
    const realOdds = { ...odds, supplier: "THE_ODDS_API" as const, dataAsOf: "2026-07-14T00:00:00.000Z" };
    expect(assessMarketData({ now: new Date("2026-07-14T03:00:00.000Z"), odds: realOdds, syncState: "IDLE", sourceVerified: true, budgetAvailable: true })).toMatchObject({ dataState: "FRESH", canSubmit: true });
    expect(assessMarketData({ now: new Date("2026-07-15T00:00:00.000Z"), odds: realOdds, syncState: "IDLE", sourceVerified: true, budgetAvailable: true })).toMatchObject({ dataState: "STALE", marketStatus: "OPEN", canSubmit: true });
  });

  it("reports sync health without closing a verified snapshot", () => {
    expect(assessMarketData({ now: new Date("2026-07-13T10:05:00Z"), odds, syncState: "SYNCING", sourceVerified: true, budgetAvailable: true })).toEqual({ dataState: "SYNCING", marketStatus: "OPEN", canSubmit: true });
    expect(assessMarketData({ now: new Date("2026-07-13T10:05:00Z"), odds, syncState: "PAUSED", sourceVerified: true, budgetAvailable: false })).toEqual({ dataState: "PAUSED", marketStatus: "OPEN", canSubmit: true });
    expect(assessMarketData({ now: new Date("2026-07-13T10:05:00Z"), odds, syncState: "FAILED", sourceVerified: true, budgetAvailable: true })).toEqual({ dataState: "STALE", marketStatus: "OPEN", canSubmit: true });
    expect(assessMarketData({ now: new Date(), odds, syncState: "IDLE", sourceVerified: false, budgetAvailable: true }).dataState).toBe("UNAVAILABLE");
  });

  it("rejects missing, invalid, or future-dated snapshots", () => {
    expect(assessMarketData({ now: new Date("2026-07-13T10:05:00Z"), odds: null, syncState: "IDLE", sourceVerified: true, budgetAvailable: true })).toEqual({ dataState: "UNAVAILABLE", marketStatus: "DATA_UNAVAILABLE", canSubmit: false });
    expect(assessMarketData({ now: new Date("2026-07-13T10:05:00Z"), odds: { ...odds, dataAsOf: "not-a-date" }, syncState: "IDLE", sourceVerified: true, budgetAvailable: true })).toEqual({ dataState: "UNAVAILABLE", marketStatus: "DATA_UNAVAILABLE", canSubmit: false });
    expect(assessMarketData({ now: new Date("2026-07-13T10:05:00Z"), odds: { ...odds, dataAsOf: "2026-07-13T10:05:00.001Z" }, syncState: "IDLE", sourceVerified: true, budgetAvailable: true })).toEqual({ dataState: "UNAVAILABLE", marketStatus: "DATA_UNAVAILABLE", canSubmit: false });
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
