import { describe, expect, it } from "vitest";
import { normalizeMatch } from "./types.js";

describe("normalizeMatch", () => {
  it("accepts JSON-encoded odds from a database driver without crashing the match list", () => {
    const match = normalizeMatch({
      id: "openligadb:7001", competitionName: "世界杯", kickoffAt: "2026-07-14T20:00:00.000Z", status: "SCHEDULED",
      homeTeam: { name: "法国" }, awayTeam: { name: "西班牙" },
      market: { id: "fixed-market", marketStatus: "OPEN", dataState: "FRESH", odds: JSON.stringify([
        { selection: "HOME", decimalOdds: "3.00" }, { selection: "DRAW", decimalOdds: "3.00" }, { selection: "AWAY", decimalOdds: "3.00" },
      ]), trace: { marketId: 1, oddsVersion: "fixed-v1" } },
    } as unknown as Parameters<typeof normalizeMatch>[0]);

    expect(match?.market).toEqual({ id: "fixed-market", version: "fixed-v1", home: "3.00", draw: "3.00", away: "3.00" });
  });

  it("degrades malformed odds to an unavailable market instead of throwing", () => {
    expect(() => normalizeMatch({
      id: "bad", kickoffAt: "2026-07-14T20:00:00.000Z", status: "SCHEDULED",
      market: { id: "bad-market", marketStatus: "OPEN", dataState: "FRESH", odds: { invalid: true }, trace: { oddsVersion: "bad-v1" } },
    } as unknown as Parameters<typeof normalizeMatch>[0])).not.toThrow();
  });

  it("uses the product market id for ticket submission rather than the supplier trace id", () => {
    const match = normalizeMatch({
      id: "api-football:101",
      competitionName: "Premier League",
      kickoffAt: "2026-07-14T20:00:00.000Z",
      status: "SCHEDULED",
      homeTeam: { name: "Home" },
      awayTeam: { name: "Away" },
      market: {
        id: "api-football:101:bookmaker:8:market:1",
        marketStatus: "OPEN",
        dataState: "FRESH",
        odds: [
          { selection: "HOME", decimalOdds: "2.10" },
          { selection: "DRAW", decimalOdds: "3.20" },
          { selection: "AWAY", decimalOdds: "3.40" },
        ],
        trace: { marketId: 1, oddsVersion: "odds-v2" },
      },
    });

    expect(match?.market).toMatchObject({ id: "api-football:101:bookmaker:8:market:1", version: "odds-v2" });
    expect(match?.competitionName).toBe("Premier League");
  });

  it("keeps a confirmed final score for a finished match", () => {
    const match = normalizeMatch({
      id: "openligadb:7001",
      competitionName: "世界杯",
      kickoffAt: "2026-07-14T20:00:00.000Z",
      status: "FINISHED",
      homeTeam: { name: "英格兰" },
      awayTeam: { name: "阿根廷" },
      result: { confirmed: true, homeScore: 2, awayScore: 1, version: "result-v1" },
    } as unknown as Parameters<typeof normalizeMatch>[0]);

    expect(match?.result).toEqual({ homeScore: 2, awayScore: 1 });
  });

  it("exposes an open correct-score market with its listed outcomes and OTHER catch-all", () => {
    const match = normalizeMatch({
      id: "openligadb:7001", competitionName: "世界杯", kickoffAt: "2026-07-14T20:00:00.000Z", status: "SCHEDULED",
      homeTeam: { name: "法国" }, awayTeam: { name: "西班牙" },
      market: { id: "m1", marketStatus: "OPEN", dataState: "FRESH", odds: [
        { selection: "HOME", decimalOdds: "3.00" }, { selection: "DRAW", decimalOdds: "3.00" }, { selection: "AWAY", decimalOdds: "3.00" },
      ], trace: { marketId: 1, oddsVersion: "m1-v1" } },
      correctScoreMarket: { id: "cs1", marketStatus: "OPEN", dataState: "FRESH", odds: [
        { selection: "2-1", supplierLabel: "2:1", decimalOdds: "8.00" }, { selection: "OTHER", supplierLabel: "其它", decimalOdds: "5.00" },
      ], trace: { marketId: 2, oddsVersion: "cs1-v1" } },
    } as unknown as Parameters<typeof normalizeMatch>[0]);

    expect(match?.correctScore).toEqual({ id: "cs1", version: "cs1-v1", outcomes: [
      { selection: "2-1", decimalOdds: "8.00" }, { selection: "OTHER", decimalOdds: "5.00" },
    ] });
  });

  it("omits the correct-score market when absent or not open", () => {
    const base = {
      id: "openligadb:7002", competitionName: "世界杯", kickoffAt: "2026-07-14T20:00:00.000Z", status: "SCHEDULED",
      homeTeam: { name: "法国" }, awayTeam: { name: "西班牙" },
    };
    expect(normalizeMatch(base as unknown as Parameters<typeof normalizeMatch>[0])?.correctScore).toBeUndefined();
    expect(normalizeMatch({ ...base, correctScoreMarket: { id: "cs", marketStatus: "DATA_UNAVAILABLE", odds: [], trace: { oddsVersion: null } } } as unknown as Parameters<typeof normalizeMatch>[0])?.correctScore).toBeUndefined();
  });

  it("ignores unconfirmed or invalid final scores", () => {
    const base = {
      id: "openligadb:7001", kickoffAt: "2026-07-14T20:00:00.000Z", status: "FINISHED",
      homeTeam: { name: "英格兰" }, awayTeam: { name: "阿根廷" },
    };

    expect(normalizeMatch({ ...base, result: { confirmed: false, homeScore: 2, awayScore: 1 } } as unknown as Parameters<typeof normalizeMatch>[0])?.result).toBeUndefined();
    expect(normalizeMatch({ ...base, result: { confirmed: true, homeScore: -1, awayScore: 1 } } as unknown as Parameters<typeof normalizeMatch>[0])?.result).toBeUndefined();
    expect(normalizeMatch({ ...base, result: { confirmed: true, homeScore: 1.5, awayScore: 1 } } as unknown as Parameters<typeof normalizeMatch>[0])?.result).toBeUndefined();
  });
});
