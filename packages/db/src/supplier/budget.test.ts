import { describe, expect, it } from "vitest";
import { decideBudgetConsumption, reconcileBudgetRow, toBudgetSnapshot, type SupplierBudgetRow } from "./budget.js";

const row = (overrides: Partial<SupplierBudgetRow> = {}): SupplierBudgetRow => ({
  billingDay: "2026-07-13",
  totalUsed: 0,
  staticUsed: 0,
  prematchOddsUsed: 0,
  liveUsed: 0,
  settlementUsed: 0,
  supplierLimit: null,
  ...overrides,
});

describe("PostgreSQL supplier budget decisions", () => {
  it("keeps ten calls protected from ordinary synchronization", () => {
    expect(decideBudgetConsumption(row({ totalUsed: 85, liveUsed: 70 }), "LIVE", 1)).toMatchObject({ allowed: false, reason: "CATEGORY_EXHAUSTED" });
    expect(decideBudgetConsumption(row({ totalUsed: 85, settlementUsed: 0 }), "SETTLEMENT", 10)).toMatchObject({ allowed: true, row: { totalUsed: 95, settlementUsed: 10 } });
  });

  it("never lets ordinary categories cross the protected reserve", () => {
    expect(decideBudgetConsumption(row({ totalUsed: 85, staticUsed: 0 }), "STATIC", 1)).toMatchObject({ allowed: false, reason: "PROTECTED_RESERVE" });
  });

  it("adopts a more conservative supplier count while retaining the 95 hard limit", () => {
    const reconciled = reconcileBudgetRow(row({ totalUsed: 2 }), 100, 88);
    expect(reconciled).toMatchObject({ totalUsed: 12, supplierLimit: 100 });
    expect(toBudgetSnapshot(reconciled)).toMatchObject({ effectiveUsed: 12, hardLimit: 95, remaining: 83 });
    expect(reconcileBudgetRow(row(), 100, 0).totalUsed).toBe(95);
  });
});
