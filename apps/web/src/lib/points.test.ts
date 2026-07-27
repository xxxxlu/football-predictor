import { describe, expect, it } from "vitest";
import { formatOdds, formatPoints, formatPointsDelta } from "./points";

describe("formatPoints", () => {
  it("groups thousands and drops the dead .00 the server always sends", () => {
    expect(formatPoints("10000.00")).toBe("10,000");
    expect(formatPoints("0.00")).toBe("0");
    expect(formatPoints("333")).toBe("333");
  });

  it("keeps genuine decimals — stake × odds is not always whole", () => {
    expect(formatPoints("336.33")).toBe("336.33");
    expect(formatPoints("336.30")).toBe("336.30");
    expect(formatPoints("-1250.5")).toBe("-1,250.50");
  });

  it("falls back on missing or unparseable values instead of printing NaN", () => {
    expect(formatPoints(null)).toBe("—");
    expect(formatPoints(undefined)).toBe("—");
    expect(formatPoints("")).toBe("—");
    expect(formatPoints("未公开")).toBe("—");
    expect(formatPoints(null, "未公开")).toBe("未公开");
  });
});

describe("formatPointsDelta", () => {
  it("signs the change explicitly, never by colour alone", () => {
    expect(formatPointsDelta("25")).toBe("+25");
    expect(formatPointsDelta("-10")).toBe("-10");
    expect(formatPointsDelta("0.00")).toBe("0");
    expect(formatPointsDelta("2500.75")).toBe("+2,500.75");
  });
});

describe("formatOdds", () => {
  it("pins odds to two decimals so a column stays aligned", () => {
    expect(formatOdds("1.5")).toBe("1.50");
    expect(formatOdds("2.05")).toBe("2.05");
    expect(formatOdds(null)).toBe("—");
  });
});
