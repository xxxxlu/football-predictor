import { describe, expect, it } from "vitest";
import {
  computeOddsTrend,
  computeMatchOddsMovements,
  isScoreAlteringEvent,
  type LiveMatchEvent,
} from "./live-feed.js";

describe("Live Feed & Odds Movement Domain", () => {
  describe("computeOddsTrend", () => {
    it("returns FLAT if no previous odds", () => {
      expect(computeOddsTrend("2.10")).toBe("FLAT");
      expect(computeOddsTrend("2.10", undefined)).toBe("FLAT");
    });

    it("detects UP trend when odds increase", () => {
      expect(computeOddsTrend("2.25", "2.10")).toBe("UP");
      expect(computeOddsTrend("1.95", "1.90")).toBe("UP");
    });

    it("detects DOWN trend when odds drop", () => {
      expect(computeOddsTrend("1.85", "2.05")).toBe("DOWN");
      expect(computeOddsTrend("3.10", "3.40")).toBe("DOWN");
    });

    it("detects FLAT when odds are unchanged or differences are negligible", () => {
      expect(computeOddsTrend("2.10", "2.10")).toBe("FLAT");
      expect(computeOddsTrend("2.1001", "2.1000")).toBe("FLAT");
    });

    it("handles invalid number strings gracefully", () => {
      expect(computeOddsTrend("abc", "2.10")).toBe("FLAT");
      expect(computeOddsTrend("2.10", "xyz")).toBe("FLAT");
    });
  });

  describe("computeMatchOddsMovements", () => {
    it("returns empty map if previous odds is undefined", () => {
      expect(computeMatchOddsMovements({ HOME: "2.10", DRAW: "3.20", AWAY: "3.50" })).toEqual({});
    });

    it("computes directional changes across all 1X2 selections", () => {
      const current = { HOME: "2.30", DRAW: "3.20", AWAY: "3.10" };
      const previous = { HOME: "2.10", DRAW: "3.20", AWAY: "3.40" };

      const movements = computeMatchOddsMovements(current, previous);
      expect(movements.HOME).toBe("UP");
      expect(movements.DRAW).toBe("FLAT");
      expect(movements.AWAY).toBe("DOWN");
    });
  });

  describe("isScoreAlteringEvent", () => {
    it("identifies GOAL as score altering", () => {
      const goalEvent: LiveMatchEvent = {
        id: "ev-1",
        type: "GOAL",
        minute: 34,
        team: "HOME",
        playerName: "Kane",
      };
      expect(isScoreAlteringEvent(goalEvent)).toBe(true);
    });

    it("identifies CARDS and other events as non-score altering", () => {
      const cardEvent: LiveMatchEvent = {
        id: "ev-2",
        type: "YELLOW_CARD",
        minute: 41,
        team: "AWAY",
      };
      expect(isScoreAlteringEvent(cardEvent)).toBe(false);
    });
  });
});
