import { describe, expect, it } from "vitest";
import { InMemorySupplierBudget, emptyBudgetState } from "./index.js";

describe("supplier daily budget", () => {
  it("reserves the final ten requests from ordinary synchronization", async () => {
    const budget = new InMemorySupplierBudget(emptyBudgetState("2026-07-13"));

    expect((await budget.consume({ category: "LIVE", count: 70, at: new Date("2026-07-13T23:59:00Z") })).allowed).toBe(true);
    expect((await budget.consume({ category: "PREMATCH_ODDS", count: 10, at: new Date("2026-07-13T23:59:01Z") })).allowed).toBe(true);
    expect((await budget.consume({ category: "STATIC", count: 5, at: new Date("2026-07-13T23:59:02Z") })).allowed).toBe(true);
    expect(await budget.consume({ category: "LIVE", count: 1, at: new Date("2026-07-13T23:59:03Z") })).toMatchObject({ allowed: false, reason: "CATEGORY_EXHAUSTED" });
    expect((await budget.consume({ category: "SETTLEMENT", count: 10, at: new Date("2026-07-13T23:59:04Z") })).allowed).toBe(true);
    expect((await budget.snapshot(new Date("2026-07-13T23:59:05Z"))).totalUsed).toBe(95);
  });

  it("resets counters on the UTC billing-day boundary", async () => {
    const budget = new InMemorySupplierBudget(emptyBudgetState("2026-07-13"));
    await budget.consume({ category: "STATIC", count: 5, at: new Date("2026-07-13T23:59:59Z") });

    const result = await budget.consume({ category: "STATIC", count: 1, at: new Date("2026-07-14T00:00:00Z") });

    expect(result.allowed).toBe(true);
    expect((await budget.snapshot(new Date("2026-07-14T00:00:00Z"))).totalUsed).toBe(1);
  });

  it("adopts the more conservative supplier header count without raising the hard limit", async () => {
    const budget = new InMemorySupplierBudget(emptyBudgetState("2026-07-13"));
    await budget.consume({ category: "STATIC", count: 2, at: new Date("2026-07-13T10:00:00Z") });

    await budget.reconcile({ at: new Date("2026-07-13T10:01:00Z"), supplierLimit: 100, supplierRemaining: 90 });
    const state = await budget.snapshot(new Date("2026-07-13T10:01:00Z"));

    expect(state.effectiveUsed).toBe(10);
    expect(state.hardLimit).toBe(95);
    expect(state.remaining).toBe(85);
  });

  it("serializes concurrent consumption so the cap cannot be exceeded", async () => {
    const budget = new InMemorySupplierBudget(emptyBudgetState("2026-07-13"));
    const results = await Promise.all(
      Array.from({ length: 6 }, () => budget.consume({ category: "STATIC", count: 1, at: new Date("2026-07-13T10:00:00Z") })),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect((await budget.snapshot(new Date("2026-07-13T10:00:00Z"))).totalUsed).toBe(5);
  });
});
