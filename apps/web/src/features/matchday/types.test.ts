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
});
