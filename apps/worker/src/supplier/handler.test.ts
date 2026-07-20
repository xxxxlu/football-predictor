import { describe, expect, it } from "vitest";
import type { FixtureSnapshot, LineupSnapshot, TeamLineup } from "@football-predictor/domain";
import { createSupplierJobHandler, type MatchSnapshotRepositoryPort, type SupplierBudgetPort, type SupplierClientPort } from "./handler.js";

const now = new Date("2026-07-13T23:50:00.000Z");
const fixture = { id: "api-football:101", supplierFixtureId: 101 };
const odds = { fixtureId: "api-football:101", version: "odds-v1" };
const live = { fixtureId: "api-football:101", minute: 62 };

// Scheduled and 40 minutes from kickoff → the near-kickoff policy (15-minute cadence) applies.
const lineupFixture: Pick<FixtureSnapshot, "id" | "supplierFixtureId" | "status" | "kickoffAt"> = {
  id: "api-football:101", supplierFixtureId: 101, status: "SCHEDULED", kickoffAt: "2026-07-14T00:30:00.000Z",
};
const teamLineup = (teamId: number, name: string): TeamLineup => ({
  teamId, name, logoUrl: null, primaryColor: null, formation: "4-3-3", coach: null, players: [],
});
const lineupSnapshot: LineupSnapshot = {
  fixtureId: "api-football:101", supplierFixtureId: 101, status: "CONFIRMED",
  dataAsOf: "2026-07-13T23:45:00.000Z", capturedAt: "2026-07-13T23:45:00.000Z",
  home: teamLineup(1, "主队"), away: teamLineup(2, "客队"),
};

function setup(overrides: {
  decision?: Awaited<ReturnType<SupplierBudgetPort["consume"]>>;
  client?: Partial<SupplierClientPort>;
  fixtureRecord?: Pick<FixtureSnapshot, "id" | "supplierFixtureId" | "status" | "kickoffAt"> | null;
  lineupData?: LineupSnapshot | null;
} = {}) {
  const events: string[] = [];
  const states: string[] = [];
  const saved = { fixtures: [] as unknown[], odds: [] as unknown[], live: [] as unknown[], lineups: [] as unknown[] };
  const budget: SupplierBudgetPort = {
    consume: async () => {
      events.push("budget.consume");
      return overrides.decision ?? { allowed: true, snapshot: { remaining: 94, protectedRemaining: 10, usedByCategory: { LIVE: 0 } } };
    },
    reconcile: async (input) => {
      events.push(`budget.reconcile:${input.supplierRemaining}`);
      return { remaining: 80, protectedRemaining: 10, usedByCategory: { LIVE: 5 } };
    },
  };
  const repository: MatchSnapshotRepositoryPort = {
    saveFixtures: async (value) => { events.push("repository.fixtures"); saved.fixtures.push(...value); },
    saveOdds: async (value) => { events.push("repository.odds"); saved.odds.push(value); },
    saveLive: async (value) => { events.push("repository.live"); saved.live.push(value); },
    getFixture: async () => { events.push("repository.getFixture"); return overrides.fixtureRecord === undefined ? lineupFixture : overrides.fixtureRecord; },
    getLineup: async () => { events.push("repository.getLineup"); return null; },
    saveLineup: async (value) => { events.push("repository.lineup"); saved.lineups.push(value); },
    setSyncState: async (_matchId, state) => { states.push(state); },
  };
  const defaults: SupplierClientPort = {
    fetchFixtures: async () => { events.push("client.fixtures"); return { data: [fixture], quota: { supplierLimit: 100, supplierRemaining: 94 } }; },
    fetchPrematchOdds: async () => { events.push("client.odds"); return { data: odds, quota: {} }; },
    fetchLive: async () => { events.push("client.live"); return { data: live, quota: {} }; },
    fetchLineups: async () => { events.push("client.lineups"); return { data: overrides.lineupData === undefined ? lineupSnapshot : overrides.lineupData, quota: { supplierLimit: 100, supplierRemaining: 92 } }; },
    fetchStatus: async () => { events.push("client.status"); return { supplierCurrent: 12, supplierLimit: 100 }; },
  };
  const client = { ...defaults, ...overrides.client };
  return { handler: createSupplierJobHandler({ client, budget, repository, clock: { now: () => now } }), events, states, saved };
}

describe("supplier worker job handler", () => {
  it("charges before a fixture request, reconciles the response header and saves snapshots", async () => {
    const { handler, events, saved } = setup();

    const result = await handler.run({ type: "FIXTURES", attempt: 0, payload: { leagueId: 1, season: 2026, from: "2026-07-13", to: "2026-07-14" } });

    expect(result).toMatchObject({ outcome: "SUCCESS", synced: 1 });
    expect(events).toEqual(["budget.consume", "client.fixtures", "budget.reconcile:94", "repository.fixtures"]);
    expect(saved.fixtures).toEqual([fixture]);
  });

  it("defers odds until the next UTC day when its budget is exhausted without calling the supplier", async () => {
    const { handler, events, states } = setup({ decision: { allowed: false, reason: "CATEGORY_EXHAUSTED", snapshot: { remaining: 20, protectedRemaining: 10, usedByCategory: { LIVE: 60 } } } });

    const result = await handler.run({ type: "PREMATCH_ODDS", attempt: 0, payload: { fixtureId: 101, matchId: "api-football:101", bookmakerId: 8 } });

    expect(result).toEqual({ outcome: "DEFERRED", reason: "BUDGET_EXHAUSTED", retryAt: "2026-07-14T00:00:00.000Z" });
    expect(events).toEqual(["budget.consume"]);
    expect(states).toEqual(["SYNCING", "PAUSED"]);
  });

  it("reports protected-reserve deferral distinctly for live synchronization", async () => {
    const { handler, events } = setup({ decision: { allowed: false, reason: "PROTECTED_RESERVE", snapshot: { remaining: 10, protectedRemaining: 10, usedByCategory: { LIVE: 70 } } } });

    const result = await handler.run({ type: "LIVE", attempt: 0, payload: { fixtureId: 101, matchId: "api-football:101", bookmakerId: 8 } });

    expect(result).toEqual({ outcome: "DEFERRED", reason: "PROTECTED_RESERVE", retryAt: "2026-07-14T00:00:00.000Z" });
    expect(events).toEqual(["budget.consume"]);
  });

  it("returns bounded exponential retry metadata for supplier failures", async () => {
    const { handler, states } = setup({ client: { fetchPrematchOdds: async () => { throw new Error("timeout"); } } });

    const result = await handler.run({ type: "PREMATCH_ODDS", attempt: 3, payload: { fixtureId: 101, matchId: "api-football:101", bookmakerId: 8 } });

    expect(result).toEqual({ outcome: "RETRY", reason: "SUPPLIER_FAILURE", retryAt: "2026-07-13T23:54:00.000Z", nextAttempt: 4 });
    expect(states).toEqual(["SYNCING", "FAILED"]);
  });

  it("persists every market from a paged league/date odds request and exposes the next page", async () => {
    const secondOdds = { fixtureId: "api-football:102", version: "odds-v2" };
    const { handler, events, saved } = setup({
      client: {
        fetchPrematchOddsPage: async () => {
          events.push("client.odds.batch");
          return { data: [odds, secondOdds], quota: {}, paging: { current: 1, total: 2 } };
        },
      },
    });

    const result = await handler.run({ type: "PREMATCH_ODDS_BATCH", attempt: 0, payload: { leagueId: 39, season: 2026, date: "2026-07-13", bookmakerId: 8, page: 1 } });

    expect(result).toEqual({ outcome: "SUCCESS", synced: 2, nextPage: 2 });
    expect(events).toEqual(["budget.consume", "client.odds.batch", "repository.odds", "repository.odds"]);
    expect(saved.odds).toEqual([odds, secondOdds]);
  });

  it("saves live cache and schedules a five-minute refresh while budget is healthy", async () => {
    const { handler, saved } = setup();

    const result = await handler.run({ type: "LIVE", attempt: 0, payload: { fixtureId: 101, matchId: "api-football:101", bookmakerId: 8 } });

    expect(result).toEqual({ outcome: "SUCCESS", synced: 1, nextRunAt: "2026-07-13T23:55:00.000Z" });
    expect(saved.live).toEqual([live]);
  });

  it("calibrates through status without consuming the billable budget", async () => {
    const { handler, events } = setup();

    const result = await handler.run({ type: "STATUS_CALIBRATE", attempt: 0, payload: {} });

    expect(result).toEqual({ outcome: "SUCCESS", synced: 0 });
    expect(events).toEqual(["client.status", "budget.reconcile:88"]);
  });

  it("charges STATIC, caches a published lineup and schedules by the near-kickoff cadence", async () => {
    const { handler, events, saved } = setup();

    const result = await handler.run({ type: "LINEUPS", attempt: 0, payload: { fixtureId: 101, matchId: "api-football:101" } });

    expect(result).toEqual({ outcome: "SUCCESS", synced: 1, nextRunAt: "2026-07-14T00:05:00.000Z" });
    expect(events).toEqual(["repository.getFixture", "budget.consume", "repository.getLineup", "client.lineups", "repository.lineup", "budget.reconcile:92"]);
    expect(saved.lineups).toEqual([lineupSnapshot]);
  });

  it("keeps the prior cache and reports LINEUP_PENDING when the supplier has not published a lineup", async () => {
    const { handler, events, saved } = setup({ lineupData: null });

    const result = await handler.run({ type: "LINEUPS", attempt: 0, payload: { fixtureId: 101, matchId: "api-football:101" } });

    expect(result).toEqual({ outcome: "PENDING", reason: "LINEUP_PENDING", nextRunAt: "2026-07-14T00:05:00.000Z" });
    expect(events).toEqual(["repository.getFixture", "budget.consume", "repository.getLineup", "client.lineups", "budget.reconcile:92"]);
    expect(saved.lineups).toEqual([]);
  });

  it("does not spend budget on a finished fixture", async () => {
    const { handler, events } = setup({ fixtureRecord: { id: "api-football:101", supplierFixtureId: 101, status: "FINISHED", kickoffAt: "2026-07-13T22:00:00.000Z" } });

    const result = await handler.run({ type: "LINEUPS", attempt: 0, payload: { fixtureId: 101, matchId: "api-football:101" } });

    expect(result).toEqual({ outcome: "SUCCESS", synced: 0 });
    expect(events).toEqual(["repository.getFixture"]);
  });

  it("defers a lineup request when the STATIC budget is exhausted", async () => {
    const { handler, events, saved } = setup({ decision: { allowed: false, reason: "CATEGORY_EXHAUSTED", snapshot: { remaining: 5, protectedRemaining: 10, usedByCategory: { LIVE: 0 } } } });

    const result = await handler.run({ type: "LINEUPS", attempt: 0, payload: { fixtureId: 101, matchId: "api-football:101" } });

    expect(result).toEqual({ outcome: "DEFERRED", reason: "BUDGET_EXHAUSTED", retryAt: "2026-07-14T00:00:00.000Z" });
    expect(events).toEqual(["repository.getFixture", "budget.consume"]);
    expect(saved.lineups).toEqual([]);
  });

  it("retries a lineup request on a supplier failure without corrupting the cache", async () => {
    const { handler, saved } = setup({ client: { fetchLineups: async () => { throw new Error("timeout"); } } });

    const result = await handler.run({ type: "LINEUPS", attempt: 2, payload: { fixtureId: 101, matchId: "api-football:101" } });

    expect(result).toEqual({ outcome: "RETRY", reason: "SUPPLIER_FAILURE", retryAt: "2026-07-13T23:52:00.000Z", nextAttempt: 3 });
    expect(saved.lineups).toEqual([]);
  });
});
