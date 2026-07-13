import { describe, expect, it } from "vitest";
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
