import { describe, expect, it } from "vitest";
import type { LineupSnapshot } from "@football-predictor/domain";
import { createPostgresSupplierWorkerComposition, createSupplierWorkerComposition } from "./composition.js";

describe("supplier worker composition", () => {
  it("runs all supplier job types through one injected composition and closes persistence", async () => {
    const events: string[] = [];
    const composition = createSupplierWorkerComposition({
      clock: { now: () => new Date("2026-07-13T10:00:00Z") },
      client: {
        fetchFixtures: async () => ({ data: [], quota: {} }),
        fetchPrematchOdds: async () => ({ data: null, quota: {} }),
        fetchLive: async () => ({ data: null, quota: {} }),
        fetchStatus: async () => ({ supplierCurrent: 10, supplierLimit: 100 }),
      },
      persistence: {
        budget: {
          consume: async () => ({ allowed: true, snapshot: { remaining: 94, protectedRemaining: 10, usedByCategory: { LIVE: 0 } } }),
          reconcile: async () => { events.push("reconciled"); return { remaining: 85, protectedRemaining: 10, usedByCategory: { LIVE: 0 } }; },
        },
        repository: {
          saveFixtures: async () => undefined,
          saveOdds: async () => undefined,
          saveLive: async () => undefined,
          setSyncState: async () => undefined,
        },
        close: async () => { events.push("closed"); },
      },
    });

    await expect(composition.run({ type: "STATUS_CALIBRATE", attempt: 0, payload: {} })).resolves.toEqual({ outcome: "SUCCESS", synced: 0 });
    await composition.close();
    expect(events).toEqual(["reconciled", "closed"]);
  });

  it("runs a lineup job through the injected composition and caches the snapshot", async () => {
    const savedLineups: LineupSnapshot[] = [];
    const lineup: LineupSnapshot = {
      fixtureId: "api-football:101", supplierFixtureId: 101, status: "CONFIRMED",
      dataAsOf: "2026-07-13T09:45:00Z", capturedAt: "2026-07-13T09:45:00Z",
      home: { teamId: 1, name: "主队", logoUrl: null, primaryColor: null, formation: "4-3-3", coach: null, players: [] },
      away: { teamId: 2, name: "客队", logoUrl: null, primaryColor: null, formation: "4-4-2", coach: null, players: [] },
    };
    const composition = createSupplierWorkerComposition({
      clock: { now: () => new Date("2026-07-13T10:00:00Z") },
      client: {
        fetchFixtures: async () => ({ data: [], quota: {} }),
        fetchPrematchOdds: async () => ({ data: null, quota: {} }),
        fetchLive: async () => ({ data: null, quota: {} }),
        fetchLineups: async () => ({ data: lineup, quota: {} }),
        fetchStatus: async () => ({ supplierCurrent: 10, supplierLimit: 100 }),
      },
      persistence: {
        budget: {
          consume: async () => ({ allowed: true, snapshot: { remaining: 94, protectedRemaining: 10, usedByCategory: { LIVE: 0 } } }),
          reconcile: async () => ({ remaining: 85, protectedRemaining: 10, usedByCategory: { LIVE: 0 } }),
        },
        repository: {
          saveFixtures: async () => undefined,
          saveOdds: async () => undefined,
          saveLive: async () => undefined,
          setSyncState: async () => undefined,
          getFixture: async () => ({ id: "api-football:101", supplierFixtureId: 101, status: "LIVE", kickoffAt: "2026-07-13T09:00:00Z" }),
          getLineup: async () => null,
          saveLineup: async (snapshot) => { savedLineups.push(snapshot); },
          claimExternalSync: async () => true,
        },
        close: async () => undefined,
      },
    });

    const result = await composition.run({ type: "LINEUPS", attempt: 0, payload: { fixtureId: 101, matchId: "api-football:101" } });
    expect(result).toMatchObject({ outcome: "SUCCESS", synced: 1 });
    expect(savedLineups).toEqual([lineup]);
  });
});

describe("PostgreSQL supplier composition", () => {
  it("creates persistence from DATABASE_URL and composes the job runner", async () => {
    let receivedUrl = "";
    const persistence = {
      budget: { consume: async () => ({ allowed: true as const, snapshot: { remaining: 94, protectedRemaining: 10, usedByCategory: { LIVE: 0 } } }), reconcile: async () => ({ remaining: 85, protectedRemaining: 10, usedByCategory: { LIVE: 0 } }) },
      repository: { saveFixtures: async () => undefined, saveOdds: async () => undefined, saveLive: async () => undefined, setSyncState: async () => undefined },
      close: async () => undefined,
    };
    const composition = createPostgresSupplierWorkerComposition({
      databaseUrl: "postgresql://localhost/football",
      clock: { now: () => new Date("2026-07-13T10:00:00Z") },
      client: { fetchFixtures: async () => ({ data: [], quota: {} }), fetchPrematchOdds: async () => ({ data: null, quota: {} }), fetchLive: async () => ({ data: null, quota: {} }), fetchStatus: async () => ({ supplierCurrent: 0, supplierLimit: 100 }) },
      createPersistence: (url) => { receivedUrl = url; return persistence; },
    });
    expect(receivedUrl).toBe("postgresql://localhost/football");
    await expect(composition.run({ type: "FIXTURES", attempt: 0, payload: { leagueId: 1, season: 2026, from: "2026-07-13", to: "2026-07-14" } })).resolves.toMatchObject({ outcome: "SUCCESS" });
  });
});
