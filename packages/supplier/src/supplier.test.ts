import { describe, expect, it } from "vitest";
import { InMemoryMatchSnapshotRepository, MatchCacheReader, SupplierSyncService, planNextLiveSync } from "./index.js";
import { InMemorySupplierBudget, emptyBudgetState } from "@football-predictor/domain";

const now = new Date("2026-07-13T10:05:00Z");
const fixture = { id: "api-football:101", supplier: "API_FOOTBALL" as const, supplierFixtureId: 101, competitionId: 1, competitionName: "World Cup", season: 2026, kickoffAt: "2026-07-13T12:00:00.000Z", status: "SCHEDULED" as const, homeTeam: { supplierTeamId: 10, name: "Home" }, awayTeam: { supplierTeamId: 20, name: "Away" }, version: "f1", dataAsOf: "2026-07-13T09:00:00.000Z", capturedAt: "2026-07-13T09:00:01.000Z" };
const odds = { productMarketId: `${fixture.id}:bookmaker:8:market:1`, fixtureId: fixture.id, supplier: "API_FOOTBALL" as const, supplierFixtureId: 101, bookmakerId: 8, bookmakerName: "Bookmaker", marketId: 1, marketName: "Match Winner", version: "o1", dataAsOf: "2026-07-13T10:00:00.000Z", capturedAt: "2026-07-13T10:00:01.000Z", outcomes: [{ selection: "HOME" as const, supplierLabel: "Home", decimalOdds: "2.1" }, { selection: "DRAW" as const, supplierLabel: "Draw", decimalOdds: "3.2" }, { selection: "AWAY" as const, supplierLabel: "Away", decimalOdds: "3.4" }] };

describe("supplier synchronization", () => {
  it("charges the budget before fetching and version-saves fixture snapshots", async () => {
    const events: string[] = [];
    const repository = new InMemoryMatchSnapshotRepository();
    const budget = new InMemorySupplierBudget(emptyBudgetState("2026-07-13"));
    const service = new SupplierSyncService({ repository, budget: { ...budget, consume: async (request) => { events.push("budget"); return budget.consume(request); }, reconcile: budget.reconcile.bind(budget), snapshot: budget.snapshot.bind(budget) }, gateway: { fetchFixtures: async () => { events.push("fetch"); return { data: [fixture], quota: { supplierLimit: 100, supplierRemaining: 94 } }; }, fetchPrematchOdds: async () => ({ data: odds, quota: {} }), fetchLive: async () => ({ data: null, quota: {} }) }, now: () => now });

    await expect(service.syncFixtures({ leagueId: 1, season: 2026, from: "2026-07-13", to: "2026-07-14" })).resolves.toEqual({ synced: 1 });
    expect(events).toEqual(["budget", "fetch"]);
    expect(await repository.getFixture(fixture.id)).toEqual(fixture);
  });

  it("does not call the gateway when the category budget is exhausted", async () => {
    let calls = 0;
    const repository = new InMemoryMatchSnapshotRepository();
    const budget = new InMemorySupplierBudget(emptyBudgetState("2026-07-13"));
    await budget.consume({ category: "PREMATCH_ODDS", count: 10, at: now });
    const service = new SupplierSyncService({ repository, budget, gateway: { fetchFixtures: async () => ({ data: [], quota: {} }), fetchPrematchOdds: async () => { calls += 1; return { data: odds, quota: {} }; }, fetchLive: async () => ({ data: null, quota: {} }) }, now: () => now });

    await expect(service.syncPrematchOdds({ fixtureId: 101, matchId: fixture.id, bookmakerId: 8 })).rejects.toMatchObject({ code: "SUPPLIER_BUDGET_EXHAUSTED" });
    expect(calls).toBe(0);
  });

  it("calibrates from the non-billable status endpoint without consuming a request", async () => {
    const repository = new InMemoryMatchSnapshotRepository();
    const budget = new InMemorySupplierBudget(emptyBudgetState("2026-07-13"));
    const service = new SupplierSyncService({ repository, budget, gateway: { fetchFixtures: async () => ({ data: [], quota: {} }), fetchPrematchOdds: async () => ({ data: null, quota: {} }), fetchLive: async () => ({ data: null, quota: {} }), fetchStatus: async () => ({ supplierCurrent: 12, supplierLimit: 100 }) }, now: () => now });

    const snapshot = await service.calibrateBudget();

    expect(snapshot).toMatchObject({ effectiveUsed: 12, hardLimit: 95, remaining: 83 });
    expect(snapshot.usedByCategory).toEqual({ STATIC: 0, PREMATCH_ODDS: 0, LIVE: 0, SETTLEMENT: 0 });
  });
});

describe("cached match reads", () => {
  it("returns cache data and an ETag without any supplier dependency", async () => {
    const repository = new InMemoryMatchSnapshotRepository();
    await repository.saveFixtures([fixture]);
    await repository.saveOdds(odds);
    const reader = new MatchCacheReader({ repository, now: () => now });

    const result = await reader.get(fixture.id);

    expect(result.view.market.dataState).toBe("FRESH");
    expect(result.etag).toMatch(/^"[a-f0-9]{64}"$/);
  });

  it("returns DATA_UNAVAILABLE instead of backfilling a missing odds cache", async () => {
    const repository = new InMemoryMatchSnapshotRepository();
    await repository.saveFixtures([fixture]);
    const reader = new MatchCacheReader({ repository, now: () => now });

    const result = await reader.get(fixture.id);

    expect(result.view.market).toMatchObject({ marketStatus: "DATA_UNAVAILABLE", canSubmit: false, dataState: "UNAVAILABLE" });
  });
});

describe("live synchronization degradation", () => {
  it("refreshes at five minutes while budget is healthy", () => {
    expect(planNextLiveSync({ liveUsed: 20, remaining: 60, protectedRemaining: 10 })).toEqual({ action: "SYNC", delayMs: 5 * 60_000 });
  });

  it("slows to ten minutes near the protected reserve and then pauses", () => {
    expect(planNextLiveSync({ liveUsed: 65, remaining: 15, protectedRemaining: 10 })).toEqual({ action: "SYNC", delayMs: 10 * 60_000 });
    expect(planNextLiveSync({ liveUsed: 70, remaining: 10, protectedRemaining: 10 })).toEqual({ action: "PAUSE", delayMs: null });
  });
});
