import { describe, expect, it } from "vitest";
import { decimalToAmerican, decimalToFractional, formatOdds } from "./odds-format";

describe("odds-format utilities", () => {
  it("formats decimal odds properly", () => {
    expect(formatOdds("2.10", "decimal")).toBe("2.10");
    expect(formatOdds(3, "decimal")).toBe("3.00");
    expect(formatOdds("—", "decimal")).toBe("—");
    expect(formatOdds(undefined, "decimal")).toBe("—");
  });

  it("converts decimal odds to British fractional odds", () => {
    expect(decimalToFractional(2.5)).toBe("3/2");
    expect(decimalToFractional(2.1)).toBe("11/10");
    expect(decimalToFractional(3.0)).toBe("2/1");
    expect(decimalToFractional(1.5)).toBe("1/2");
    expect(decimalToFractional(4.0)).toBe("3/1");
  });

  it("converts decimal odds to American moneyline odds", () => {
    expect(decimalToAmerican(2.1)).toBe("+110");
    expect(decimalToAmerican(3.0)).toBe("+200");
    expect(decimalToAmerican(1.5)).toBe("-200");
    expect(decimalToAmerican(1.8)).toBe("-125");
  });

  it("handles edge cases in formatOdds gracefully", () => {
    expect(formatOdds("2.50", "fractional")).toBe("3/2");
    expect(formatOdds("2.10", "american")).toBe("+110");
    expect(formatOdds(null, "american")).toBe("—");
  });
});
