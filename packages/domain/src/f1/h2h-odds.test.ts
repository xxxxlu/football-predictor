import { describe, expect, it } from "vitest";
import { h2hOdds, H2H_MIN_ODDS, H2H_MAX_ODDS } from "./h2h-odds.js";

describe("h2hOdds", () => {
  it("prices an even pairing symmetrically below 2.0 (margin retained)", () => {
    const { oddsA, oddsB } = h2hOdds({ pointsA: 100, pointsB: 100 });
    expect(oddsA).toBe(oddsB);
    expect(Number(oddsA)).toBeGreaterThan(1.5);
    expect(Number(oddsA)).toBeLessThan(2);
  });

  it("never settles a lopsided pairing at even money on both sides", () => {
    const { oddsA, oddsB } = h2hOdds({ pointsA: 250, pointsB: 2 });
    expect(Number(oddsA)).toBeLessThan(Number(oddsB));
    expect(Number(oddsA)).toBeGreaterThanOrEqual(H2H_MIN_ODDS);
    expect(Number(oddsB)).toBeGreaterThan(3);
  });

  it("clamps extremes into the [min, max] band", () => {
    const { oddsA, oddsB } = h2hOdds({ pointsA: 10_000, pointsB: 0 });
    expect(Number(oddsA)).toBe(H2H_MIN_ODDS);
    expect(Number(oddsB)).toBe(H2H_MAX_ODDS);
  });

  it("handles two zero-point rookies deterministically", () => {
    const { oddsA, oddsB } = h2hOdds({ pointsA: 0, pointsB: 0 });
    expect(oddsA).toBe(oddsB);
  });

  it("rejects negative or non-finite points", () => {
    expect(() => h2hOdds({ pointsA: -1, pointsB: 0 })).toThrow(RangeError);
    expect(() => h2hOdds({ pointsA: Number.NaN, pointsB: 0 })).toThrow(RangeError);
  });

  it("emits 2dp decimal strings compatible with the settlement odds parser", () => {
    const { oddsA, oddsB } = h2hOdds({ pointsA: 87, pointsB: 143 });
    expect(oddsA).toMatch(/^\d+\.\d{2}$/);
    expect(oddsB).toMatch(/^\d+\.\d{2}$/);
  });
});
