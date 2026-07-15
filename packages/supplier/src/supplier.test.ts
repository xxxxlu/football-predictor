import { describe, expect, it } from "vitest";
import { InMemoryMatchSnapshotRepository, MatchCacheReader, OpenLigaDbClient, OpenLigaDbWorldCupSync, SupplierSyncService, TheOddsApiClient, planNextLiveSync } from "./index.js";
import { InMemorySupplierBudget, emptyBudgetState } from "@football-predictor/domain";

const now = new Date("2026-07-13T10:05:00Z");
const fixture = { id: "api-football:101", supplier: "API_FOOTBALL" as const, supplierFixtureId: 101, competitionId: 1, competitionName: "World Cup", season: 2026, kickoffAt: "2026-07-13T12:00:00.000Z", status: "SCHEDULED" as const, homeTeam: { supplierTeamId: 10, name: "Home" }, awayTeam: { supplierTeamId: 20, name: "Away" }, version: "f1", dataAsOf: "2026-07-13T09:00:00.000Z", capturedAt: "2026-07-13T09:00:01.000Z" };
const odds = { productMarketId: `${fixture.id}:bookmaker:8:market:1`, fixtureId: fixture.id, supplier: "API_FOOTBALL" as const, supplierFixtureId: 101, bookmakerId: 8, bookmakerName: "Bookmaker", marketId: 1, marketName: "Match Winner", version: "o1", dataAsOf: "2026-07-13T10:00:00.000Z", capturedAt: "2026-07-13T10:00:01.000Z", outcomes: [{ selection: "HOME" as const, supplierLabel: "Home", decimalOdds: "2.1" }, { selection: "DRAW" as const, supplierLabel: "Draw", decimalOdds: "3.2" }, { selection: "AWAY" as const, supplierLabel: "Away", decimalOdds: "3.4" }] };

describe("supplier synchronization", () => {
  it("maps one complete real bookmaker market onto the matching OpenLigaDB fixture", async () => {
    const source = [{ matchID: 7001, leagueId: 501, leagueName: "WM 2026", leagueSeason: 2026, leagueShortcut: "wm26", matchDateTimeUTC: "2026-07-14T19:00:00Z", lastUpdateDateTime: "2026-07-14T09:00:00Z", matchIsFinished: false, team1: { teamId: 10, teamName: "Frankreich", shortName: "FRA" }, team2: { teamId: 20, teamName: "Spanien", shortName: "ESP" }, matchResults: [] }];
    const oddsPayload = [{ id: "world-cup-event", commence_time: "2026-07-14T19:00:00Z", home_team: "France", away_team: "Spain", bookmakers: [
      { key: "incomplete", title: "Incomplete", last_update: "2026-07-14T09:55:00Z", markets: [{ key: "h2h", outcomes: [{ name: "France", price: 2.1 }] }] },
      { key: "real-book", title: "Real Book", last_update: "2026-07-14T09:58:00Z", markets: [{ key: "h2h", outcomes: [{ name: "France", price: 2.25 }, { name: "Draw", price: 3.2 }, { name: "Spain", price: 3.05 }] }] },
    ] }];
    const repository = new InMemoryMatchSnapshotRepository();
    const client = new OpenLigaDbClient({ fetcher: async () => Response.json(source), now: () => new Date("2026-07-14T10:00:00Z") });
    const oddsClient = new TheOddsApiClient({ apiKey: "test-key", fetcher: async () => Response.json(oddsPayload), now: () => new Date("2026-07-14T10:00:00Z") });
    const sync = new OpenLigaDbWorldCupSync({ repository, client, oddsClient, now: () => new Date("2026-07-14T10:00:00Z") });

    await expect(sync.run()).resolves.toEqual({ fixturesSynced: 1, marketsSynced: 1, oddsRequestMade: true });
    await expect(repository.getOdds("openligadb:7001")).resolves.toMatchObject({
      supplier: "THE_ODDS_API", bookmakerName: "Real Book", marketName: "胜平负真实赔率", dataAsOf: "2026-07-14T09:58:00.000Z",
      outcomes: [{ selection: "HOME", decimalOdds: "2.25" }, { selection: "DRAW", decimalOdds: "3.20" }, { selection: "AWAY", decimalOdds: "3.05" }],
    });
  });

  it("reuses persisted real odds for two hours instead of spending credits on page reads", async () => {
    const source = [{ matchID: 7001, leagueId: 501, leagueName: "WM 2026", leagueSeason: 2026, leagueShortcut: "wm26", matchDateTimeUTC: "2026-07-15T19:00:00Z", lastUpdateDateTime: "2026-07-14T09:00:00Z", matchIsFinished: false, team1: { teamId: 10, teamName: "France", shortName: "FRA" }, team2: { teamId: 20, teamName: "Spain", shortName: "ESP" }, matchResults: [] }];
    const repository = new InMemoryMatchSnapshotRepository();
    let oddsCalls = 0;
    const firstNow = new Date("2026-07-14T10:00:00Z");
    const client = new OpenLigaDbClient({ fetcher: async () => Response.json(source), now: () => firstNow });
    const oddsClient = new TheOddsApiClient({ apiKey: "test-key", fetcher: async () => {
      oddsCalls += 1;
      return Response.json([{ id: "event", commence_time: "2026-07-15T19:00:00Z", home_team: "France", away_team: "Spain", bookmakers: [{ key: "book", title: "Book", last_update: "2026-07-14T09:59:00Z", markets: [{ key: "h2h", outcomes: [{ name: "France", price: 2 }, { name: "Draw", price: 3 }, { name: "Spain", price: 4 }] }] }] }]);
    }, now: () => firstNow });
    await new OpenLigaDbWorldCupSync({ repository, client, oddsClient, now: () => firstNow }).run();

    const second = new OpenLigaDbWorldCupSync({ repository, client, oddsClient, now: () => new Date("2026-07-14T11:59:59Z") });
    await expect(second.run()).resolves.toMatchObject({ oddsRequestMade: false, marketsSynced: 0 });
    expect(oddsCalls).toBe(1);

    const third = new OpenLigaDbWorldCupSync({ repository, client, oddsClient, now: () => new Date("2026-07-14T12:00:00Z") });
    await expect(third.run()).resolves.toMatchObject({ oddsRequestMade: true });
    expect(oddsCalls).toBe(2);
  });

  it("maps current OpenLigaDB World Cup fixtures to Chinese names and platform scoring markets", async () => {
    const source = [{ matchID: 7001, leagueId: 501, leagueName: "WM 2026", leagueSeason: 2026, leagueShortcut: "wm26", matchDateTimeUTC: "2026-07-14T19:00:00Z", lastUpdateDateTime: "2026-07-14T09:00:00Z", matchIsFinished: false, team1: { teamId: 10, teamName: "Frankreich", shortName: "FRA" }, team2: { teamId: 20, teamName: "Spanien", shortName: "ESP" }, matchResults: [] }];
    const repository = new InMemoryMatchSnapshotRepository();
    const client = new OpenLigaDbClient({ fetcher: async () => Response.json(source), now: () => new Date("2026-07-14T10:00:00Z") });
    const sync = new OpenLigaDbWorldCupSync({ repository, client, now: () => new Date("2026-07-14T10:00:00Z") });

    await expect(sync.run()).resolves.toEqual({ fixturesSynced: 1, marketsSynced: 1, oddsRequestMade: false });
    expect(await repository.getFixture("openligadb:7001")).toMatchObject({ supplier: "OPENLIGADB", competitionName: "世界杯", homeTeam: { name: "法国" }, awayTeam: { name: "西班牙" } });
    const market = await repository.getOdds("openligadb:7001");
    expect(market).toMatchObject({ supplier: "PLATFORM", bookmakerName: "平台固定虚拟积分", marketName: "胜平负固定积分倍率" });
    expect(market?.outcomes.map((outcome) => outcome.decimalOdds)).toEqual(["3.00", "3.00", "3.00"]);
  });

  it("imports the complete 2026 World Cup schedule including older finished matches", async () => {
    const match = (matchID: number, kickoffAt: string, finished: boolean) => ({ matchID, leagueId: 501, leagueName: "WM 2026", leagueSeason: 2026, leagueShortcut: "wm26", matchDateTimeUTC: kickoffAt, lastUpdateDateTime: "2026-07-14T10:00:00Z", matchIsFinished: finished, team1: { teamId: 10, teamName: "England", shortName: "ENG" }, team2: { teamId: 20, teamName: "Argentina", shortName: "ARG" }, matchResults: finished ? [{ resultTypeID: 2, pointsTeam1: 1, pointsTeam2: 2 }] : [] });
    const repository = new InMemoryMatchSnapshotRepository();
    const client = new OpenLigaDbClient({ fetcher: async () => Response.json([match(1, "2026-06-11T19:00:00Z", true), match(2, "2026-07-14T08:00:00Z", true), match(3, "2026-07-15T19:00:00Z", false)]), now: () => new Date("2026-07-14T10:00:00Z") });
    const sync = new OpenLigaDbWorldCupSync({ repository, client, now: () => new Date("2026-07-14T10:00:00Z") });

    await expect(sync.run()).resolves.toEqual({ fixturesSynced: 3, marketsSynced: 1, oddsRequestMade: false });
    expect(await repository.getFixture("openligadb:1")).toMatchObject({ status: "FINISHED", result: { confirmed: true } });
    expect(await repository.getFixture("openligadb:2")).toMatchObject({ status: "FINISHED", result: { confirmed: true, homeScore: 1, awayScore: 2 } });
  });

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
    await budget.consume({ category: "PREMATCH_ODDS", count: 50, at: now });
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
