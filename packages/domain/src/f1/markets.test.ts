import { describe, expect, it } from "vitest";
import {
  F1_SUPPLIER_MARKET_IDS,
  f1MarketKindFromSupplierMarketId,
  f1MarketKindsForSession,
  f1MarketId,
  parseF1MarketId,
  f1FixtureId,
  parseF1FixtureId,
} from "./markets.js";
import { CONVENTIONAL_WEEKEND_SESSIONS, SPRINT_WEEKEND_SESSIONS } from "./types.js";

describe("F1 markets", () => {
  it("keeps synthetic supplier ids clear of football's 1X2/correct-score ids", () => {
    for (const id of Object.values(F1_SUPPLIER_MARKET_IDS)) {
      expect(id).toBeGreaterThanOrEqual(100);
    }
    expect(f1MarketKindFromSupplierMarketId(1)).toBeNull();
    expect(f1MarketKindFromSupplierMarketId(2)).toBeNull();
    expect(f1MarketKindFromSupplierMarketId(104)).toBe("EXACT_PODIUM");
  });

  it("offers pole on qualifying sessions and winner on races (§12.5)", () => {
    expect(f1MarketKindsForSession("QUALIFYING")).toContain("POLE");
    expect(f1MarketKindsForSession("SPRINT_QUALIFYING")).toContain("POLE");
    expect(f1MarketKindsForSession("SPRINT")).toContain("WINNER");
    expect(f1MarketKindsForSession("GRAND_PRIX")).toContain("WINNER");
    for (const kind of ["QUALIFYING", "SPRINT_QUALIFYING", "SPRINT", "GRAND_PRIX"] as const) {
      const kinds = f1MarketKindsForSession(kind);
      expect(kinds).toContain("PODIUM");
      expect(kinds).toContain("EXACT_PODIUM");
      expect(kinds).toContain("H2H");
      expect(kinds).toHaveLength(4);
    }
  });

  it("keeps all four session kinds across the two weekend shapes (§12.5 已确认范围)", () => {
    expect(CONVENTIONAL_WEEKEND_SESSIONS).toEqual(["QUALIFYING", "GRAND_PRIX"]);
    expect(SPRINT_WEEKEND_SESSIONS).toEqual(["SPRINT_QUALIFYING", "SPRINT", "QUALIFYING", "GRAND_PRIX"]);
  });

  it("round-trips market and fixture ids", () => {
    const marketId = f1MarketId("session-42", "H2H");
    expect(marketId).toBe("f1:session-42:H2H");
    expect(parseF1MarketId(marketId)).toEqual({ sessionId: "session-42", kind: "H2H" });
    expect(parseF1MarketId("supplier:1:2")).toBeNull();
    expect(parseF1FixtureId(f1FixtureId("session-42"))).toBe("session-42");
    expect(parseF1FixtureId("fixture-1")).toBeNull();
  });
});
