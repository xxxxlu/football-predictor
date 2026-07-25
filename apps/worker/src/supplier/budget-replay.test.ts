import { describe, expect, it } from "vitest";
import { InMemorySupplierBudget, emptyBudgetState, SUPPLIER_HARD_LIMIT } from "@pulse/domain";
import { createSupplierJobHandler, type MatchSnapshotRepositoryPort, type SupplierClientPort } from "./handler.js";

// Story 7.5 / NFR42 gate G3 — "worst matchday" supplier-budget replay.
// This is a HANDLER-level integration replay (distinct from the domain-model unit test in
// packages/domain/src/supplier-budget): it drives the real createSupplierJobHandler through a full
// day of jobs against the real InMemorySupplierBudget and asserts the release-gate invariants:
//   - daily supplier requests never exceed the hard limit (95)
//   - ordinary synchronization consumes 0 of the settlement-protected reserve
//   - exhaustion defers (no supplier call, no budget spend) instead of overspending
//   - the protected reserve stays available to SETTLEMENT after ordinary categories are exhausted

const DAY = "2026-07-13";
const now = new Date(`${DAY}T12:00:00.000Z`);

function replayHarness() {
  const budget = new InMemorySupplierBudget(emptyBudgetState(DAY));
  const fetches = { fixtures: 0, odds: 0, live: 0 };
  // Empty quota headers keep totalUsed driven purely by consume() (reconcile is a no-op), so the
  // replay counts real charge decisions rather than supplier-reported usage.
  const client: SupplierClientPort = {
    fetchFixtures: async () => { fetches.fixtures += 1; return { data: [{ id: "api-football:1", supplierFixtureId: 1 }], quota: {} }; },
    fetchPrematchOdds: async () => { fetches.odds += 1; return { data: { fixtureId: "api-football:1", version: "v1" }, quota: {} }; },
    fetchLive: async () => { fetches.live += 1; return { data: { fixtureId: "api-football:1", minute: 10 }, quota: {} }; },
    fetchStatus: async () => ({ supplierCurrent: 0, supplierLimit: 100 }),
  };
  const repository: MatchSnapshotRepositoryPort = {
    saveFixtures: async () => {},
    saveOdds: async () => {},
    saveLive: async () => {},
    setSyncState: async () => {},
  };
  const handler = createSupplierJobHandler({ client, budget, repository, clock: { now: () => now } });
  const totalFetches = () => fetches.fixtures + fetches.odds + fetches.live;
  return { handler, budget, fetches, totalFetches };
}

describe("supplier budget release-gate replay (NFR42)", () => {
  it("stays within 95 requests across a worst matchday, defers on exhaustion, and preserves the settlement reserve", async () => {
    const { handler, budget, totalFetches } = replayHarness();

    // Ordinary categories at their baselines: 30 STATIC (fixtures) + 50 PREMATCH_ODDS + 5 LIVE = 85.
    for (let i = 0; i < 30; i += 1) {
      const result = await handler.run({ type: "FIXTURES", attempt: 0, payload: { leagueId: i, season: 2026, from: DAY, to: DAY } });
      expect(result.outcome).toBe("SUCCESS");
    }
    for (let i = 0; i < 50; i += 1) {
      const result = await handler.run({ type: "PREMATCH_ODDS", attempt: 0, payload: { fixtureId: i, matchId: `api-football:${i}`, bookmakerId: 8 } });
      expect(result.outcome).toBe("SUCCESS");
    }
    for (let i = 0; i < 5; i += 1) {
      const result = await handler.run({ type: "LIVE", attempt: 0, payload: { fixtureId: i, matchId: `api-football:${i}`, bookmakerId: 8 } });
      expect(result.outcome).toBe("SUCCESS");
    }

    // The 85 ordinary requests stop exactly at HARD_LIMIT - reserve: the 10-request reserve is intact.
    const afterOrdinary = await budget.snapshot(now);
    expect(afterOrdinary.totalUsed).toBe(85);
    expect(afterOrdinary.remaining).toBe(10);
    expect(afterOrdinary.protectedRemaining).toBe(10);
    expect(totalFetches()).toBe(85);

    // A further ordinary (LIVE) request is deferred to the next UTC day without a supplier call.
    const overflowLive = await handler.run({ type: "LIVE", attempt: 0, payload: { fixtureId: 99, matchId: "api-football:99", bookmakerId: 8 } });
    expect(overflowLive).toMatchObject({ outcome: "DEFERRED", reason: "BUDGET_EXHAUSTED", retryAt: "2026-07-14T00:00:00.000Z" });
    expect(totalFetches()).toBe(85);

    // SETTLEMENT (RESULTS) is exempt from the category cap and may draw down the protected reserve.
    for (let i = 0; i < 10; i += 1) {
      const result = await handler.run({ type: "RESULTS", attempt: 0, payload: { leagueId: i, season: 2026, from: DAY, to: DAY } });
      expect(result.outcome).toBe("SUCCESS");
    }

    // The hard ceiling holds: the 11th settlement request is deferred and no request ever exceeds 95.
    const overflowSettlement = await handler.run({ type: "RESULTS", attempt: 0, payload: { leagueId: 99, season: 2026, from: DAY, to: DAY } });
    expect(overflowSettlement).toMatchObject({ outcome: "DEFERRED", reason: "BUDGET_EXHAUSTED" });

    const final = await budget.snapshot(now);
    expect(final.totalUsed).toBe(95);
    expect(final.usedByCategory).toEqual({ STATIC: 30, PREMATCH_ODDS: 50, LIVE: 5, SETTLEMENT: 10 });
    expect(final.remaining).toBe(0);
    expect(totalFetches()).toBe(95);
    expect(totalFetches()).toBeLessThanOrEqual(SUPPLIER_HARD_LIMIT);
  });
});
