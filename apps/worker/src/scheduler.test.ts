import { describe, expect, it } from "vitest";
import { createWorkerScheduler, type SchedulerTimerPort } from "./scheduler.js";

class FakeTimers implements SchedulerTimerPort {
  readonly callbacks: Array<() => void> = [];
  setInterval(callback: () => void): unknown { this.callbacks.push(callback); return callback; }
  clearInterval(): void {}
  tickAll() { for (const callback of this.callbacks) callback(); }
}

const schedulerConfig = (competitions = [{ leagueId: 1, season: 2026 }]) => ({
  competitions,
  bookmakerId: 8,
  pastDays: 1,
  futureDays: 7,
  fixturesIntervalMs: 60_000,
  resultsIntervalMs: 120_000,
  oddsIntervalMs: 60_000,
  settlementIntervalMs: 60_000,
  liveEnabled: false,
  liveIntervalMs: 300_000,
  settlementBatchSize: 100,
});

describe("worker scheduler", () => {
  it("rejects startup when supplier calibration is not successful", async () => {
    const scheduler = createWorkerScheduler({
      config: schedulerConfig(),
      clock: { now: () => new Date("2026-07-13T10:00:00Z") }, timers: new FakeTimers(),
      supplier: { run: async () => ({ outcome: "RETRY", reason: "SUPPLIER_FAILURE", retryAt: "2026-07-13T10:01:00Z", nextAttempt: 1 }), close: async () => undefined },
      settlement: { scan: async () => ({ outcome: "SUCCESS", processed: 0, held: 0, failedTicketIds: [] }), close: async () => undefined },
      fixtures: { listFixtures: async () => [] }, write: () => undefined,
    });
    await expect(scheduler.start()).rejects.toThrow("STATUS_CALIBRATE");
    await scheduler.stop();
  });

  it("starts with status/fixtures, schedules cached target odds and settlement, with live disabled", async () => {
    const jobs: string[] = [];
    const logs: unknown[] = [];
    const timers = new FakeTimers();
    const scheduler = createWorkerScheduler({
      config: schedulerConfig(),
      clock: { now: () => new Date("2026-07-13T10:00:00Z") }, timers,
      supplier: { run: async (job) => { jobs.push(job.type); return { outcome: "SUCCESS", synced: 1 }; }, close: async () => undefined },
      settlement: { scan: async () => ({ outcome: "SUCCESS", processed: 0, held: 0, failedTicketIds: [] }), close: async () => undefined },
      fixtures: { listFixtures: async () => [{ id: "api-football:101", supplierFixtureId: 101, kickoffAt: "2026-07-14T12:00:00Z", status: "SCHEDULED" }] },
      write: (entry) => logs.push(entry),
    });
    await scheduler.start();
    expect(jobs).toEqual(["STATUS_CALIBRATE", "FIXTURES", "PREMATCH_ODDS"]);
    expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({ event: "worker.job.completed", jobType: "FIXTURES" })]));
    await scheduler.stop();
  });

  it("refreshes every configured competition sequentially before odds", async () => {
    const calls: string[] = [];
    let active = 0;
    let maxActive = 0;
    const scheduler = createWorkerScheduler({
      config: schedulerConfig([{ leagueId: 39, season: 2026 }, { leagueId: 140, season: 2026 }, { leagueId: 2, season: 2026 }]),
      clock: { now: () => new Date("2026-07-13T10:00:00Z") }, timers: new FakeTimers(),
      supplier: {
        run: async (job) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          if (job.type === "FIXTURES") calls.push(`${job.payload.leagueId}:${job.payload.season}`);
          await Promise.resolve();
          active -= 1;
          return { outcome: "SUCCESS", synced: 0 };
        },
        close: async () => undefined,
      },
      settlement: { scan: async () => ({ outcome: "SUCCESS", processed: 0, held: 0, failedTicketIds: [] }), close: async () => undefined },
      fixtures: { listFixtures: async () => [] }, write: () => undefined,
    });

    await scheduler.start();
    expect(calls).toEqual(["39:2026", "140:2026", "2:2026"]);
    expect(maxActive).toBe(1);
    await scheduler.stop();
  });

  it("only refreshes future stale odds in nearest-kickoff order without concurrent supplier calls", async () => {
    const calls: number[] = [];
    let active = 0;
    let maxActive = 0;
    const scheduler = createWorkerScheduler({
      config: schedulerConfig(),
      clock: { now: () => new Date("2026-07-13T10:00:00Z") }, timers: new FakeTimers(),
      supplier: {
        run: async (job) => {
          if (job.type === "PREMATCH_ODDS") {
            active += 1;
            maxActive = Math.max(maxActive, active);
            calls.push(job.payload.fixtureId);
            await Promise.resolve();
            active -= 1;
          }
          return { outcome: "SUCCESS", synced: 0 };
        },
        close: async () => undefined,
      },
      settlement: { scan: async () => ({ outcome: "SUCCESS", processed: 0, held: 0, failedTicketIds: [] }), close: async () => undefined },
      fixtures: { listFixtures: async () => [
        { id: "past", supplierFixtureId: 1, kickoffAt: "2026-07-13T09:59:59Z", status: "SCHEDULED" },
        { id: "later", supplierFixtureId: 3, kickoffAt: "2026-07-13T13:00:00Z", status: "SCHEDULED" },
        { id: "fresh", supplierFixtureId: 4, kickoffAt: "2026-07-13T11:00:00Z", status: "SCHEDULED", oddsDataAsOf: "2026-07-13T09:55:00Z" },
        { id: "nearest", supplierFixtureId: 2, kickoffAt: "2026-07-13T10:30:00Z", status: "SCHEDULED" },
      ] },
      write: () => undefined,
    });

    await scheduler.start();
    expect(calls).toEqual([2, 3]);
    expect(maxActive).toBe(1);
    await scheduler.stop();
  });

  it("warms many matches through one paged league/date odds group instead of one request per fixture", async () => {
    const jobs: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const scheduler = createWorkerScheduler({
      config: schedulerConfig([{ leagueId: 39, season: 2026 }]),
      clock: { now: () => new Date("2026-07-13T10:00:00Z") }, timers: new FakeTimers(),
      supplier: {
        run: async (job) => {
          jobs.push(job);
          if (job.type === "PREMATCH_ODDS_BATCH" && job.payload.page === 1) return { outcome: "SUCCESS", synced: 10, nextPage: 2 };
          return { outcome: "SUCCESS", synced: 2 };
        },
        close: async () => undefined,
      },
      settlement: { scan: async () => ({ outcome: "SUCCESS", processed: 0, held: 0, failedTicketIds: [] }), close: async () => undefined },
      fixtures: { listFixtures: async () => Array.from({ length: 12 }, (_, index) => ({ id: `api-football:${100 + index}`, supplierFixtureId: 100 + index, competitionId: 39, season: 2026, kickoffAt: `2026-07-14T${String(10 + index).padStart(2, "0")}:00:00Z`, status: "SCHEDULED" as const })) },
      write: () => undefined,
    });

    await scheduler.start();

    const oddsJobs = jobs.filter((job) => job.type === "PREMATCH_ODDS_BATCH");
    expect(oddsJobs.map((job) => job.payload)).toEqual([
      { leagueId: 39, season: 2026, date: "2026-07-14", bookmakerId: 8, page: 1 },
      { leagueId: 39, season: 2026, date: "2026-07-14", bookmakerId: 8, page: 2 },
    ]);
    expect(jobs.some((job) => job.type === "PREMATCH_ODDS")).toBe(false);
    await scheduler.stop();
  });

  it("uses a protected result-refresh job on the periodic fixture cycle", async () => {
    const jobs: string[] = [];
    const timers = new FakeTimers();
    const scheduler = createWorkerScheduler({
      config: schedulerConfig(),
      clock: { now: () => new Date("2026-07-13T10:00:00Z") }, timers,
      supplier: { run: async (job) => { jobs.push(job.type); return { outcome: "SUCCESS", synced: 0 }; }, close: async () => undefined },
      settlement: { scan: async () => ({ outcome: "SUCCESS", processed: 0, held: 0, failedTicketIds: [] }), close: async () => undefined },
      fixtures: { listFixtures: async () => [] }, write: () => undefined,
    });
    await scheduler.start();
    timers.callbacks[1]?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(jobs).toContain("RESULTS");
    await scheduler.stop();
  });

  it("honors retryAt and prevents interval re-entry", async () => {
    let now = new Date("2026-07-13T10:00:00Z");
    let oddsCalls = 0;
    let release!: () => void;
    let fixtureCalls = 0;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const timers = new FakeTimers();
    const scheduler = createWorkerScheduler({
      config: schedulerConfig(),
      clock: { now: () => now }, timers,
      supplier: { run: async (job) => {
        if (job.type === "PREMATCH_ODDS") { oddsCalls += 1; return { outcome: "DEFERRED", reason: "BUDGET_EXHAUSTED", retryAt: "2026-07-14T00:00:00.000Z" }; }
        if (job.type === "FIXTURES" && fixtureCalls++ > 0) await blocker;
        jobsStarted += 1;
        return { outcome: "SUCCESS", synced: 0 };
      }, close: async () => undefined },
      settlement: { scan: async () => ({ outcome: "SUCCESS", processed: 0, held: 0, failedTicketIds: [] }), close: async () => undefined },
      fixtures: { listFixtures: async () => [{ id: "api-football:101", supplierFixtureId: 101, kickoffAt: "2026-07-14T12:00:00Z", status: "SCHEDULED" }] },
      write: () => undefined,
    });
    let jobsStarted = 0;
    await scheduler.start();
    expect(oddsCalls).toBe(1);
    timers.tickAll(); timers.tickAll();
    await Promise.resolve();
    expect(oddsCalls).toBe(1);
    release();
    now = new Date("2026-07-14T00:00:00Z");
    timers.tickAll();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(oddsCalls).toBe(2);
    await scheduler.stop();
  });

  it("waits for in-flight work before closing dependencies", async () => {
    const order: string[] = [];
    let release!: () => void;
    let markFixtureStarted!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const fixtureStarted = new Promise<void>((resolve) => { markFixtureStarted = resolve; });
    const timers = new FakeTimers();
    const scheduler = createWorkerScheduler({
      config: schedulerConfig(),
      clock: { now: () => new Date("2026-07-13T10:00:00Z") }, timers,
      supplier: { run: async (job) => {
        if (job.type === "FIXTURES") {
          markFixtureStarted();
          await pending;
        }
        return { outcome: "SUCCESS", synced: 0 };
      }, close: async () => { order.push("supplier.close"); } },
      settlement: { scan: async () => ({ outcome: "SUCCESS", processed: 0, held: 0, failedTicketIds: [] }), close: async () => { order.push("settlement.close"); } },
      fixtures: { listFixtures: async () => [] }, write: () => undefined,
    });
    const starting = scheduler.start();
    await fixtureStarted;
    const stopping = scheduler.stop();
    expect(order).toEqual([]);
    release();
    await starting; await stopping;
    expect(order).toEqual(["supplier.close", "settlement.close"]);
  });
});
