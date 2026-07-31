import { describe, expect, it } from "vitest";

import { assertMinimalClubProjection, CLUB_RESULT_PROJECTION_KEYS } from "./projection.js";

describe("assertMinimalClubProjection", () => {
  it("accepts the exact result-row shape, including arrays and nulls", () => {
    const rows = [
      { pulseId: "alice", nickname: "Alice", answered: true, correct: true, streak: 4 },
      { pulseId: "bob", nickname: null, answered: false, correct: null, streak: 0 },
    ];
    expect(() => assertMinimalClubProjection(rows, CLUB_RESULT_PROJECTION_KEYS)).not.toThrow();
    expect(() => assertMinimalClubProjection(null, CLUB_RESULT_PROJECTION_KEYS)).not.toThrow();
  });

  it("rejects keys outside the allowlist", () => {
    expect(() =>
      assertMinimalClubProjection({ pulseId: "a", nickname: null, answered: true, correct: true, streak: 1, xpTotal: 10 }, CLUB_RESULT_PROJECTION_KEYS),
    ).toThrow(/unexpected key "xpTotal"/);
  });

  it("rejects forbidden categories even when the allowlist is widened", () => {
    for (const key of ["roomId", "balance", "points", "stakeTotal", "oddsVersion", "predictionId", "ledgerRef", "settledAt", "correctOption", "answerKey"]) {
      expect(() => assertMinimalClubProjection({ [key]: 1 }, [...CLUB_RESULT_PROJECTION_KEYS, key])).toThrow(/must never carry/);
    }
  });

  it("does not misfire on the legitimate 'answered' key", () => {
    expect(() => assertMinimalClubProjection({ answered: true }, ["answered"])).not.toThrow();
  });

  it("scans nested structures", () => {
    expect(() =>
      assertMinimalClubProjection({ pulseId: "a", nickname: { balance: 5 }, answered: true, correct: false, streak: 0 }, CLUB_RESULT_PROJECTION_KEYS),
    ).toThrow(/must never carry "balance"/);
  });
});
