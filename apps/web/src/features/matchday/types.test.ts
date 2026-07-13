import { describe, expect, it } from "vitest";
import { normalizeMatch } from "./types.js";

describe("normalizeMatch", () => {
  it("uses the product market id for ticket submission rather than the supplier trace id", () => {
    const match = normalizeMatch({
      id: "api-football:101",
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
  });
});
