import { describe, expect, it } from "vitest";
import { exactPodiumComboOdds, EXACT_PODIUM_MAX_ODDS, EXACT_PODIUM_MIN_ODDS } from "./exact-podium-odds.js";

describe("exactPodiumComboOdds", () => {
  it("prices a combo as product / 2.5 to 2dp", () => {
    expect(exactPodiumComboOdds(["5.00", "6.00", "8.00"])).toBe("96.00");
  });

  it("matches the previously enumerated seed pricing bit-for-bit", () => {
    /* ANT/LEC/NOR field odds from the 2026-07 standings seed; the enumerated
       snapshot priced POD3:ANT-LEC-NOR at 371.12 and the derived path must agree. */
    expect(exactPodiumComboOdds(["6.99", "10.61", "12.51"])).toBe("371.12");
  });

  it("clamps into the [6, 500] band", () => {
    expect(exactPodiumComboOdds(["1.15", "1.15", "1.15"])).toBe(EXACT_PODIUM_MIN_ODDS.toFixed(2));
    expect(exactPodiumComboOdds(["60.00", "60.00", "60.00"])).toBe(EXACT_PODIUM_MAX_ODDS.toFixed(2));
  });

  it("rejects malformed base odds instead of pricing garbage", () => {
    expect(exactPodiumComboOdds(["abc", "6.00", "8.00"])).toBeNull();
    expect(exactPodiumComboOdds(["", "6.00", "8.00"])).toBeNull();
    expect(exactPodiumComboOdds(["-2", "6.00", "8.00"])).toBeNull();
    expect(exactPodiumComboOdds(["0", "6.00", "8.00"])).toBeNull();
  });
});
