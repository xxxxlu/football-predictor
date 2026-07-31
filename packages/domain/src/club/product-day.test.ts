import { describe, expect, it } from "vitest";

import { previousProductDay, productDay, productDayNumber } from "./product-day.js";

describe("productDay", () => {
  it("is the UTC date string, flipping exactly at midnight UTC", () => {
    expect(productDay(new Date("2026-07-31T23:59:59.999Z"))).toBe("2026-07-31");
    expect(productDay(new Date("2026-08-01T00:00:00.000Z"))).toBe("2026-08-01");
  });

  it("ignores what any local calendar would say", () => {
    // 07:59 Beijing time on Aug 1 is still July 31 UTC.
    expect(productDay(new Date("2026-08-01T07:59:00+08:00"))).toBe("2026-07-31");
  });
});

describe("previousProductDay", () => {
  it("steps back one day across month and year boundaries", () => {
    expect(previousProductDay("2026-08-01")).toBe("2026-07-31");
    expect(previousProductDay("2026-01-01")).toBe("2025-12-31");
    expect(previousProductDay("2026-03-01")).toBe("2026-02-28");
  });
});

describe("productDayNumber", () => {
  it("is strictly increasing by one per day", () => {
    expect(productDayNumber("2026-08-01") - productDayNumber("2026-07-31")).toBe(1);
    expect(productDayNumber("1970-01-01")).toBe(0);
  });
});
