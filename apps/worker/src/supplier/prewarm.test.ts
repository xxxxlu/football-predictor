import { describe, expect, it, vi } from "vitest";
import { runSupplierPrewarm, validatePrewarmCompetitions, validatePrewarmEnvironment } from "./prewarm.js";

describe("supplier cache prewarm", () => {
  it("rejects an unsafe number of fixture synchronization requests", () => {
    expect(() => validatePrewarmCompetitions([{ leagueId: 1, season: 2026 }])).not.toThrow();
    expect(() => validatePrewarmCompetitions(Array.from({ length: 30 }, (_, index) => ({ leagueId: index + 1, season: 2026 })))).toThrow("at most 29");
  });

  it("fails fast with actionable variable names without echoing secret values", () => {
    expect(() => validatePrewarmEnvironment({ DATABASE_URL: "", API_FOOTBALL_KEY: "super-secret" })).toThrow("DATABASE_URL");
    try { validatePrewarmEnvironment({ DATABASE_URL: "" , API_FOOTBALL_KEY: "super-secret" }); }
    catch (error) { expect((error as Error).message).not.toContain("super-secret"); }
    expect(() => validatePrewarmEnvironment({ DATABASE_URL: "postgresql://localhost/app", API_FOOTBALL_KEY: "" })).toThrow("API_FOOTBALL_KEY");
  });

  it("warms fixtures and scheduled odds across competitions and reports only counts and budget", async () => {
    const jobs: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const close = vi.fn();
    const output = await runSupplierPrewarm({
      competitions: [{ leagueId: 39, season: 2026 }, { leagueId: 140, season: 2026 }],
      bookmakerId: 8, pastDays: 1, futureDays: 7,
      clock: { now: () => new Date("2026-07-14T10:00:00Z") },
      supplier: { run: async (job) => { jobs.push(job); return { outcome: "SUCCESS" as const, synced: job.type === "FIXTURES" ? 2 : job.type === "PREMATCH_ODDS" ? 1 : 0 }; }, close },
      fixtures: { listFixtures: async () => [
        { id: "api-football:2", supplierFixtureId: 2, competitionId: 140, season: 2026, kickoffAt: "2026-07-16T12:00:00Z", status: "SCHEDULED" as const, oddsDataAsOf: "2026-07-14T09:55:00Z" },
        { id: "api-football:1", supplierFixtureId: 1, competitionId: 39, season: 2026, kickoffAt: "2026-07-15T12:00:00Z", status: "SCHEDULED" as const },
        { id: "api-football:3", supplierFixtureId: 3, competitionId: 78, season: 2026, kickoffAt: "2026-07-16T12:00:00Z", status: "SCHEDULED" as const },
      ] },
      budget: { snapshot: async () => ({ remaining: 81, protectedRemaining: 10 }) },
    });
    expect(jobs.map((job) => job.type)).toEqual(["STATUS_CALIBRATE", "FIXTURES", "FIXTURES", "PREMATCH_ODDS"]);
    expect((jobs.at(-1)?.payload as { fixtureId?: number }).fixtureId).toBe(1);
    expect(output).toEqual({ competitionsSynced: 2, fixturesSynced: 4, oddsSynced: 1, oddsSkipped: 1, budgetRemaining: 81, settlementProtected: 10 });
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.stringify(output)).not.toContain("secret");
  });

  it("always closes persistence when calibration fails", async () => {
    const close = vi.fn();
    await expect(runSupplierPrewarm({
      competitions: [{ leagueId: 39, season: 2026 }], bookmakerId: 8, pastDays: 1, futureDays: 7,
      clock: { now: () => new Date("2026-07-14T10:00:00Z") },
      supplier: { run: async () => ({ outcome: "RETRY" as const, reason: "SUPPLIER_FAILURE" as const, retryAt: "2026-07-14T10:01:00Z", nextAttempt: 1 }), close },
      fixtures: { listFixtures: async () => [] }, budget: { snapshot: async () => ({ remaining: 85, protectedRemaining: 10 }) },
    })).rejects.toThrow("STATUS_CALIBRATE");
    expect(close).toHaveBeenCalledOnce();
  });
});
