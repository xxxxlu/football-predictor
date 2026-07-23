import { describe, expect, it } from "vitest";
import type { LineupSnapshot } from "@football-predictor/domain";
import { createWorkerScheduler, type SchedulerTimerPort } from "./scheduler.js";
import { createSupplierWorkerComposition } from "./supplier/composition.js";

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
    expect(jobs).toEqual(["STATUS_CALIBRATE", "FIXTURES", "PREMATCH_ODDS", "LINEUPS"]);
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

  it("enqueues lineup jobs for scheduled and live fixtures in kickoff order, skipping finished and cancelled", async () => {
    const lineupCalls: string[] = [];
    const scheduler = createWorkerScheduler({
      config: schedulerConfig(),
      clock: { now: () => new Date("2026-07-13T10:00:00Z") }, timers: new FakeTimers(),
      supplier: {
        run: async (job) => { if (job.type === "LINEUPS") lineupCalls.push(job.payload.matchId); return { outcome: "SUCCESS", synced: 0 }; },
        close: async () => undefined,
      },
      settlement: { scan: async () => ({ outcome: "SUCCESS", processed: 0, held: 0, failedTicketIds: [] }), close: async () => undefined },
      fixtures: { listFixtures: async () => [
        { id: "finished", supplierFixtureId: 1, kickoffAt: "2026-07-13T08:00:00Z", status: "FINISHED" },
        { id: "live", supplierFixtureId: 2, kickoffAt: "2026-07-13T09:30:00Z", status: "LIVE" },
        { id: "soon", supplierFixtureId: 3, kickoffAt: "2026-07-13T11:00:00Z", status: "SCHEDULED" },
        { id: "later", supplierFixtureId: 4, kickoffAt: "2026-07-14T18:00:00Z", status: "SCHEDULED" },
        { id: "cancelled", supplierFixtureId: 5, kickoffAt: "2026-07-13T12:00:00Z", status: "CANCELLED" },
      ] },
      write: () => undefined,
    });

    await scheduler.start();
    expect(lineupCalls).toEqual(["live", "soon", "later"]);
    await scheduler.stop();
  });

  it("stops the lineup batch when the shared supplier budget is exhausted", async () => {
    const lineupCalls: string[] = [];
    const scheduler = createWorkerScheduler({
      config: schedulerConfig(),
      clock: { now: () => new Date("2026-07-13T10:00:00Z") }, timers: new FakeTimers(),
      supplier: {
        run: async (job) => {
          if (job.type === "LINEUPS") { lineupCalls.push(job.payload.matchId); return { outcome: "DEFERRED", reason: "BUDGET_EXHAUSTED", retryAt: "2026-07-14T00:00:00.000Z" }; }
          return { outcome: "SUCCESS", synced: 0 };
        },
        close: async () => undefined,
      },
      settlement: { scan: async () => ({ outcome: "SUCCESS", processed: 0, held: 0, failedTicketIds: [] }), close: async () => undefined },
      fixtures: { listFixtures: async () => [
        { id: "a", supplierFixtureId: 1, kickoffAt: "2026-07-13T11:00:00Z", status: "SCHEDULED" },
        { id: "b", supplierFixtureId: 2, kickoffAt: "2026-07-13T12:00:00Z", status: "SCHEDULED" },
      ] },
      write: () => undefined,
    });

    await scheduler.start();
    expect(lineupCalls).toEqual(["a"]);
    await scheduler.stop();
  });

  it("does not re-fetch a distant fixture's lineup when the scheduler runs twice across a restart", async () => {
    const claimStore = new Map<string, number>();
    let lineupFetches = 0;
    const now = new Date("2026-07-13T10:00:00Z");
    const distantFixture = { id: "api-football:501", supplierFixtureId: 501, kickoffAt: "2026-07-16T12:00:00Z", status: "SCHEDULED" as const, oddsDataAsOf: "2026-07-13T09:59:00Z" };
    const lineup: LineupSnapshot = {
      fixtureId: "api-football:501", supplierFixtureId: 501, status: "CONFIRMED",
      dataAsOf: "2026-07-13T09:45:00Z", capturedAt: "2026-07-13T09:45:00Z",
      home: { teamId: 1, name: "主队", logoUrl: null, primaryColor: null, formation: "4-3-3", coach: null, players: [] },
      away: { teamId: 2, name: "客队", logoUrl: null, primaryColor: null, formation: "4-4-2", coach: null, players: [] },
    };
    // A fresh composition each run models a worker restart: in-memory state resets, but the durable
    // external_sync_claims store (claimStore) survives, so the second boot must not re-hit the supplier.
    const runScheduler = async () => {
      const composition = createSupplierWorkerComposition({
        clock: { now: () => now },
        client: {
          fetchFixtures: async () => ({ data: [], quota: {} }),
          fetchPrematchOdds: async () => ({ data: null, quota: {} }),
          fetchLive: async () => ({ data: null, quota: {} }),
          fetchLineups: async () => { lineupFetches += 1; return { data: lineup, quota: {} }; },
          fetchStatus: async () => ({ supplierCurrent: 0, supplierLimit: 100 }),
        },
        persistence: {
          budget: {
            consume: async () => ({ allowed: true, snapshot: { remaining: 90, protectedRemaining: 10, usedByCategory: { LIVE: 0 } } }),
            reconcile: async () => ({ remaining: 90, protectedRemaining: 10, usedByCategory: { LIVE: 0 } }),
          },
          repository: {
            saveFixtures: async () => undefined,
            saveOdds: async () => undefined,
            saveLive: async () => undefined,
            setSyncState: async () => undefined,
            getFixture: async () => ({ id: "api-football:501", supplierFixtureId: 501, status: "SCHEDULED", kickoffAt: "2026-07-16T12:00:00Z" }),
            getLineup: async () => null,
            saveLineup: async () => undefined,
            claimExternalSync: async (key, at, minimumIntervalMs) => {
              const previous = claimStore.get(key);
              if (previous !== undefined && at.getTime() - previous < minimumIntervalMs) return false;
              claimStore.set(key, at.getTime());
              return true;
            },
          },
          close: async () => undefined,
        },
      });
      const scheduler = createWorkerScheduler({
        config: schedulerConfig(),
        clock: { now: () => now }, timers: new FakeTimers(),
        supplier: composition,
        settlement: { scan: async () => ({ outcome: "SUCCESS", processed: 0, held: 0, failedTicketIds: [] }), close: async () => undefined },
        fixtures: { listFixtures: async () => [distantFixture] },
        write: () => undefined,
      });
      await scheduler.start();
      await scheduler.stop();
    };

    await runScheduler();
    expect(lineupFetches).toBe(1);
    await runScheduler();
    expect(lineupFetches).toBe(1);
  });

  it("runs the F1 lock sweep at startup before settlement and again on the settlement interval", async () => {
    const order: string[] = [];
    const timers = new FakeTimers();
    const scheduler = createWorkerScheduler({
      config: schedulerConfig(),
      clock: { now: () => new Date("2026-07-13T10:00:00Z") }, timers,
      supplier: { run: async () => ({ outcome: "SUCCESS", synced: 0 }), close: async () => undefined },
      settlement: {
        scan: async () => { order.push("settlement"); return { outcome: "SUCCESS", processed: 0, held: 0, failedTicketIds: [] }; },
        lockDueF1Sessions: async (limit) => { order.push(`f1-lock:${limit}`); return { outcome: "SUCCESS", locked: 0, marketsClosed: 0, skipped: 0, failedSessionIds: [] }; },
        close: async () => undefined,
      },
      fixtures: { listFixtures: async () => [] }, write: () => undefined,
    });

    await scheduler.start();
    expect(order).toEqual(["f1-lock:100", "settlement"]);
    timers.tickAll();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order.filter((entry) => entry.startsWith("f1-lock"))).toHaveLength(2);
    await scheduler.stop();
  });

  it("locks a session missed while the worker was down on the next boot's startup sweep", async () => {
    // Durable state shared across two scheduler lifetimes; in-memory scheduler state resets.
    const store = { state: "UPCOMING" as "UPCOMING" | "LOCKED", startsAt: "2026-07-13T12:00:00Z", openMarkets: 3 };
    const lockedAtBoot: number[] = [];
    const runScheduler = async (nowIso: string) => {
      const now = new Date(nowIso);
      const scheduler = createWorkerScheduler({
        config: schedulerConfig(),
        clock: { now: () => now }, timers: new FakeTimers(),
        supplier: { run: async () => ({ outcome: "SUCCESS", synced: 0 }), close: async () => undefined },
        settlement: {
          scan: async () => ({ outcome: "SUCCESS", processed: 0, held: 0, failedTicketIds: [] }),
          lockDueF1Sessions: async () => {
            const due = store.state === "UPCOMING" && new Date(store.startsAt).getTime() <= now.getTime();
            if (due) { store.state = "LOCKED"; const closed = store.openMarkets; store.openMarkets = 0; lockedAtBoot.push(closed); }
            return { outcome: "SUCCESS", locked: due ? 1 : 0, marketsClosed: due ? 3 : 0, skipped: 0, failedSessionIds: [] };
          },
          close: async () => undefined,
        },
        fixtures: { listFixtures: async () => [] }, write: () => undefined,
      });
      await scheduler.start();
      await scheduler.stop();
    };

    await runScheduler("2026-07-13T10:00:00Z"); // before the session starts — nothing to do
    expect(store.state).toBe("UPCOMING");
    await runScheduler("2026-07-13T14:00:00Z"); // reboot after downtime spanning startsAt
    expect(store.state).toBe("LOCKED");
    expect(store.openMarkets).toBe(0);
    await runScheduler("2026-07-13T15:00:00Z"); // a third boot is an idempotent no-op
    expect(lockedAtBoot).toEqual([3]);
  });

  it("never runs two F1 lock sweeps concurrently: interval ticks during an in-flight sweep are skipped", async () => {
    let sweeps = 0;
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const skips: unknown[] = [];
    const timers = new FakeTimers();
    const scheduler = createWorkerScheduler({
      config: schedulerConfig(),
      clock: { now: () => new Date("2026-07-13T10:00:00Z") }, timers,
      supplier: { run: async () => ({ outcome: "SUCCESS", synced: 0 }), close: async () => undefined },
      settlement: {
        scan: async () => ({ outcome: "SUCCESS", processed: 0, held: 0, failedTicketIds: [] }),
        lockDueF1Sessions: async () => {
          sweeps += 1;
          if (sweeps > 1) await blocker;
          return { outcome: "SUCCESS", locked: 0, marketsClosed: 0, skipped: 0, failedSessionIds: [] };
        },
        close: async () => undefined,
      },
      fixtures: { listFixtures: async () => [] },
      write: (entry) => { if (entry.event === "worker.job.skipped" && entry.jobType === "F1_SESSION_LOCK") skips.push(entry); },
    });

    await scheduler.start();
    expect(sweeps).toBe(1);
    timers.tickAll(); // starts sweep #2, which blocks in flight
    await Promise.resolve();
    timers.tickAll(); // sweep #3 must be refused re-entry while #2 is running
    await Promise.resolve();
    expect(sweeps).toBe(2);
    expect(skips).toHaveLength(1);
    release();
    await scheduler.stop();
  });
});
