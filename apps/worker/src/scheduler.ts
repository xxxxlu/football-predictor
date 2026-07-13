import type { SupplierJob, SupplierJobResult } from "./supplier/handler.js";

export interface SchedulerTimerPort {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface WorkerSchedulerConfig {
  leagueId: number;
  season: number;
  bookmakerId: number;
  pastDays: number;
  futureDays: number;
  fixturesIntervalMs: number;
  oddsIntervalMs: number;
  settlementIntervalMs: number;
  liveEnabled: boolean;
  liveIntervalMs: number;
  settlementBatchSize: number;
}

type FixtureTarget = {
  id: string;
  supplierFixtureId: number;
  kickoffAt: string;
  status: "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";
};

type SchedulerDependencies = {
  config: WorkerSchedulerConfig;
  clock: { now(): Date };
  timers: SchedulerTimerPort;
  supplier: { run(job: SupplierJob): Promise<SupplierJobResult>; close(): Promise<void> };
  settlement: {
    scan(limit: number): Promise<{ outcome: "SUCCESS" | "RETRY"; processed: number; held: number; failedTicketIds: string[] }>;
    close(): Promise<void>;
  };
  fixtures: { listFixtures(): Promise<FixtureTarget[]> };
  write(entry: Readonly<Record<string, unknown>>): void;
};

const DAY_MS = 86_400_000;

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export function createWorkerScheduler(dependencies: SchedulerDependencies) {
  const { config, clock, timers, supplier, settlement, fixtures, write } = dependencies;
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
    return supplierJob("fixtures", {
      type: "FIXTURES",
      payload: { leagueId: config.leagueId, season: config.season, ...window },
    });
  }

  async function refreshResults() {
    const now = clock.now();
    return supplierJob("results", {
      type: "RESULTS",
      payload: {
        leagueId: config.leagueId,
        season: config.season,
        from: dateOnly(new Date(now.getTime() - config.pastDays * DAY_MS)),
        to: dateOnly(now),
      },
    });
  }

  async function refreshFixtureAndResultCaches() {
    await refreshFixtures();
    await refreshResults();
  }

  async function refreshTargets(kind: "PREMATCH_ODDS" | "LIVE") {
    const now = clock.now().getTime();
    const min = now - config.pastDays * DAY_MS;
    const max = now + config.futureDays * DAY_MS;
    const targets = (await fixtures.listFixtures()).filter((fixture) => {
      const kickoff = new Date(fixture.kickoffAt).getTime();
      return Number.isFinite(kickoff) && kickoff >= min && kickoff <= max &&
        (kind === "PREMATCH_ODDS" ? fixture.status === "SCHEDULED" : fixture.status === "LIVE");
    });
    await Promise.all(targets.map((fixture) => supplierJob(
      `${kind.toLowerCase()}:${fixture.id}`,
      { type: kind, payload: { fixtureId: fixture.supplierFixtureId, matchId: fixture.id, bookmakerId: config.bookmakerId } },
    )));
  }

  async function scanSettlements() {
    await guarded("settlement", "SETTLEMENT_SCAN", () => settlement.scan(config.settlementBatchSize));
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
      if (fixtureRefresh?.outcome !== "SUCCESS") throw new Error("Startup job FIXTURES did not succeed");
      if (stopping) return;
      await refreshTargets("PREMATCH_ODDS");
      if (config.liveEnabled) await refreshTargets("LIVE");
      await scanSettlements();
      if (stopping) return;
      every(config.fixturesIntervalMs, refreshFixtureAndResultCaches);
      every(config.oddsIntervalMs, () => refreshTargets("PREMATCH_ODDS"));
      every(config.settlementIntervalMs, scanSettlements);
      if (config.liveEnabled) every(config.liveIntervalMs, () => refreshTargets("LIVE"));
    },

    stop(): Promise<void> {
      if (stopPromise) return stopPromise;
      stopping = true;
      for (const handle of timerHandles.splice(0)) timers.clearInterval(handle);
      stopPromise = (async () => {
        while (inFlight.size > 0) await Promise.allSettled([...inFlight.values()]);
        await supplier.close();
        await settlement.close();
      })();
      return stopPromise;
    },
  };
}
