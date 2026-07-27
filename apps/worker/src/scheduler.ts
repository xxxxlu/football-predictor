import type { SupplierJob, SupplierJobResult } from "./supplier/handler.js";

export interface SchedulerTimerPort {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface WorkerSchedulerConfig {
  competitions: ReadonlyArray<{ leagueId: number; season: number }>;
  bookmakerId: number;
  pastDays: number;
  futureDays: number;
  fixturesIntervalMs: number;
  resultsIntervalMs: number;
  oddsIntervalMs: number;
  settlementIntervalMs: number;
  liveEnabled: boolean;
  liveIntervalMs: number;
  lineupsIntervalMs?: number;
  settlementBatchSize: number;
  f1ResultsSyncEnabled?: boolean;
  f1ResultsIntervalMs?: number;
}

type FixtureTarget = {
  id: string;
  supplierFixtureId: number;
  competitionId?: number;
  season?: number;
  kickoffAt: string;
  status: "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";
  oddsDataAsOf?: string;
};

type SchedulerDependencies = {
  config: WorkerSchedulerConfig;
  clock: { now(): Date };
  timers: SchedulerTimerPort;
  supplier: { run(job: SupplierJob): Promise<SupplierJobResult>; close(): Promise<void> };
  settlement: {
    scan(limit: number): Promise<{ outcome: "SUCCESS" | "RETRY"; processed: number; held: number; failedTicketIds: string[] }>;
    /** Optional F1 lock-at-start sweep; deploys without F1 simply omit it. */
    lockDueF1Sessions?(limit: number): Promise<{ outcome: "SUCCESS" | "RETRY"; locked: number; marketsClosed: number; skipped: number; failedSessionIds: string[] }>;
    close(): Promise<void>;
  };
  fixtures: { listFixtures(): Promise<FixtureTarget[]> };
  f1Results?: { sync(): Promise<unknown>; close(): Promise<void> };
  rooms?: { closeSettledRooms(limit: number): Promise<unknown>; close(): Promise<void> };
  write(entry: Readonly<Record<string, unknown>>): void;
};

const DAY_MS = 86_400_000;
const FRESH_ODDS_MS = 10 * 60_000;
const DEFAULT_LINEUPS_INTERVAL_MS = 5 * 60_000;

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export function createWorkerScheduler(dependencies: SchedulerDependencies) {
  const { config, clock, timers, supplier, settlement, fixtures, f1Results, rooms, write } = dependencies;
  const timerHandles: unknown[] = [];
  const inFlight = new Map<string, Promise<unknown>>();
  const notBefore = new Map<string, number>();
  const attempts = new Map<string, number>();
  let started = false;
  let stopping = false;
  let stopPromise: Promise<void> | undefined;

  function log(event: string, fields: Readonly<Record<string, unknown>>) {
    write({ event, timestamp: clock.now().toISOString(), ...fields });
  }

  async function guarded<T>(key: string, jobType: string, operation: () => Promise<T>): Promise<T | undefined> {
    if (stopping) return undefined;
    const deferredUntil = notBefore.get(key);
    if (deferredUntil !== undefined && clock.now().getTime() < deferredUntil) {
      log("worker.job.skipped", { jobType, key, reason: "NOT_BEFORE", retryAt: new Date(deferredUntil).toISOString() });
      return undefined;
    }
    if (inFlight.has(key)) {
      log("worker.job.skipped", { jobType, key, reason: "REENTRY" });
      return undefined;
    }

    const startedAt = clock.now().getTime();
    log("worker.job.started", { jobType, key });
    const running = operation()
      .then((result) => {
        const scheduling = result as { retryAt?: string; nextRunAt?: string; nextAttempt?: number };
        const next = scheduling.retryAt ?? scheduling.nextRunAt;
        if (next) notBefore.set(key, new Date(next).getTime());
        else notBefore.delete(key);
        if (scheduling.nextAttempt !== undefined) attempts.set(key, scheduling.nextAttempt);
        else attempts.delete(key);
        log("worker.job.completed", { jobType, key, durationMs: Math.max(0, clock.now().getTime() - startedAt), result });
        return result;
      })
      .catch((error: unknown) => {
        log("worker.job.failed", { jobType, key, durationMs: Math.max(0, clock.now().getTime() - startedAt), error: errorName(error) });
        throw error;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, running);
    return running;
  }

  function supplierJob(key: string, job: Omit<SupplierJob, "attempt">): Promise<SupplierJobResult | undefined> {
    const completeJob = { ...job, attempt: attempts.get(key) ?? 0 } as SupplierJob;
    return guarded(key, completeJob.type, () => supplier.run(completeJob));
  }

  function fixtureWindow() {
    const now = clock.now();
    return {
      from: dateOnly(new Date(now.getTime() - config.pastDays * DAY_MS)),
      to: dateOnly(new Date(now.getTime() + config.futureDays * DAY_MS)),
    };
  }

  async function refreshFixtures() {
    const window = fixtureWindow();
    const results: Array<SupplierJobResult | undefined> = [];
    for (const competition of config.competitions) {
      results.push(await supplierJob(`fixtures:${competition.leagueId}:${competition.season}`, {
        type: "FIXTURES",
        payload: { ...competition, ...window },
      }));
    }
    return results;
  }

  async function refreshResults() {
    const now = clock.now();
    const results: Array<SupplierJobResult | undefined> = [];
    for (const competition of config.competitions) {
      results.push(await supplierJob(`results:${competition.leagueId}:${competition.season}`, {
        type: "RESULTS",
        payload: {
          ...competition,
          from: dateOnly(new Date(now.getTime() - config.pastDays * DAY_MS)),
          to: dateOnly(now),
        },
      }));
    }
    return results;
  }

  async function refreshTargets(kind: "PREMATCH_ODDS" | "LIVE") {
    const now = clock.now().getTime();
    const max = now + config.futureDays * DAY_MS;
    const targets = (await fixtures.listFixtures()).filter((fixture) => {
      const kickoff = new Date(fixture.kickoffAt).getTime();
      if (!Number.isFinite(kickoff) || kickoff > max) return false;
      if (kind === "LIVE") return kickoff >= now - config.pastDays * DAY_MS && fixture.status === "LIVE";
      if (kickoff <= now || fixture.status !== "SCHEDULED") return false;
      if (fixture.oddsDataAsOf === undefined) return true;
      const oddsDataAsOf = new Date(fixture.oddsDataAsOf).getTime();
      const age = now - oddsDataAsOf;
      return !Number.isFinite(oddsDataAsOf) || age < 0 || age > FRESH_ODDS_MS;
    }).sort((left, right) => {
      const kickoffDifference = new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime();
      return kickoffDifference || left.id.localeCompare(right.id);
    });
    if (kind === "PREMATCH_ODDS") {
      const grouped = new Map<string, { leagueId: number; season: number; date: string; kickoffAt: string }>();
      const legacy: FixtureTarget[] = [];
      for (const fixture of targets) {
        if (fixture.competitionId === undefined || fixture.season === undefined) { legacy.push(fixture); continue; }
        const date = dateOnly(new Date(fixture.kickoffAt));
        const key = `${fixture.competitionId}:${fixture.season}:${date}`;
        const current = grouped.get(key);
        if (!current || fixture.kickoffAt < current.kickoffAt) grouped.set(key, { leagueId: fixture.competitionId, season: fixture.season, date, kickoffAt: fixture.kickoffAt });
      }
      const groups = [...grouped.values()].sort((left, right) => left.kickoffAt.localeCompare(right.kickoffAt) || left.leagueId - right.leagueId);
      for (const group of groups) {
        let page = 1;
        while (true) {
          const result = await supplierJob(
            `prematch_odds_batch:${group.leagueId}:${group.season}:${group.date}:${page}`,
            { type: "PREMATCH_ODDS_BATCH", payload: { leagueId: group.leagueId, season: group.season, date: group.date, bookmakerId: config.bookmakerId, page } },
          );
          if (result?.outcome !== "SUCCESS") return;
          if (result.nextPage === undefined) break;
          page = result.nextPage;
        }
      }
      for (const fixture of legacy) {
        const result = await supplierJob(
          `prematch_odds:${fixture.id}`,
          { type: "PREMATCH_ODDS", payload: { fixtureId: fixture.supplierFixtureId, matchId: fixture.id, bookmakerId: config.bookmakerId } },
        );
        if (result?.outcome !== "SUCCESS") break;
      }
      return;
    }
    for (const fixture of targets) {
      const result = await supplierJob(
        `${kind.toLowerCase()}:${fixture.id}`,
        { type: kind, payload: { fixtureId: fixture.supplierFixtureId, matchId: fixture.id, bookmakerId: config.bookmakerId } },
      );
      if (result?.outcome !== "SUCCESS") break;
    }
  }

  async function refreshLineups() {
    const now = clock.now().getTime();
    const max = now + config.futureDays * DAY_MS;
    const min = now - config.pastDays * DAY_MS;
    const targets = (await fixtures.listFixtures()).filter((fixture) => {
      const kickoff = new Date(fixture.kickoffAt).getTime();
      if (!Number.isFinite(kickoff) || kickoff > max || kickoff < min) return false;
      return fixture.status === "SCHEDULED" || fixture.status === "LIVE";
    }).sort((left, right) => (new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime()) || left.id.localeCompare(right.id));
    for (const fixture of targets) {
      const result = await supplierJob(
        `lineups:${fixture.id}`,
        { type: "LINEUPS", payload: { fixtureId: fixture.supplierFixtureId, matchId: fixture.id } },
      );
      // Stop the batch only when the shared budget is exhausted; a per-fixture pending/failure must not
      // block the remaining fixtures (a supplier that has not published a lineup yet is not a system fault).
      if (result?.outcome === "DEFERRED") break;
    }
  }

  async function scanSettlements() {
    await guarded("settlement", "SETTLEMENT_SCAN", () => settlement.scan(config.settlementBatchSize));
  }

  async function closeSettledRooms() {
    if (!rooms) return;
    try { await guarded("room_settlement_close", "ROOM_SETTLEMENT_CLOSE", () => rooms.closeSettledRooms(config.settlementBatchSize)); }
    catch { /* guarded() has already emitted the failure; retry on the next settlement sweep. */ }
  }

  async function syncF1Results() {
    if (!f1Results || config.f1ResultsSyncEnabled === false) return;
    // F1's public result source is supplemental. Its temporary outage must never
    // prevent football refreshes, existing F1 settlement, or room closeout.
    try { await guarded("f1_results_sync", "F1_RESULTS_SYNC", () => f1Results.sync()); }
    catch { /* guarded() has already emitted the failure; retry at the next interval. */ }
  }

  // Locks F1 sessions whose start time has passed. State lives entirely in the
  // database, so the startup sweep recovers anything a downtime window missed.
  async function lockF1Sessions() {
    const lock = settlement.lockDueF1Sessions?.bind(settlement);
    if (!lock) return;
    await guarded("f1_session_lock", "F1_SESSION_LOCK", () => lock(config.settlementBatchSize));
  }

  function every(intervalMs: number, callback: () => Promise<unknown>) {
    timerHandles.push(timers.setInterval(() => { void callback().catch(() => undefined); }, intervalMs));
  }

  return {
    async start() {
      if (started) return;
      if (stopping) throw new Error("Worker scheduler is stopping");
      started = true;
      const calibration = await supplierJob("status", { type: "STATUS_CALIBRATE", payload: {} });
      if (calibration?.outcome !== "SUCCESS") throw new Error("Startup job STATUS_CALIBRATE did not succeed");
      const fixtureRefresh = await refreshFixtures();
      if (fixtureRefresh.some((result) => result?.outcome !== "SUCCESS")) throw new Error("Startup job FIXTURES did not succeed");
      if (stopping) return;
      await refreshTargets("PREMATCH_ODDS");
      if (config.liveEnabled) await refreshTargets("LIVE");
      await refreshLineups();
      await lockF1Sessions();
      await syncF1Results();
      await scanSettlements();
      await closeSettledRooms();
      if (stopping) return;
      every(config.fixturesIntervalMs, refreshFixtures);
      every(config.resultsIntervalMs, refreshResults);
      every(config.oddsIntervalMs, () => refreshTargets("PREMATCH_ODDS"));
      every(config.settlementIntervalMs, lockF1Sessions);
      if (f1Results && config.f1ResultsSyncEnabled !== false) every(config.f1ResultsIntervalMs ?? 5 * 60_000, syncF1Results);
      every(config.settlementIntervalMs, async () => { await scanSettlements(); await closeSettledRooms(); });
      if (config.liveEnabled) every(config.liveIntervalMs, () => refreshTargets("LIVE"));
      every(config.lineupsIntervalMs ?? DEFAULT_LINEUPS_INTERVAL_MS, refreshLineups);
    },

    stop(): Promise<void> {
      if (stopPromise) return stopPromise;
      stopping = true;
      for (const handle of timerHandles.splice(0)) timers.clearInterval(handle);
      stopPromise = (async () => {
        while (inFlight.size > 0) await Promise.allSettled([...inFlight.values()]);
        await supplier.close();
        await settlement.close();
        await f1Results?.close();
        await rooms?.close();
      })();
      return stopPromise;
    },
  };
}
