export type SupplierRequestCategory = "STATIC" | "PREMATCH_ODDS" | "LIVE" | "SETTLEMENT";
export type BudgetRejectionReason = "CATEGORY_EXHAUSTED" | "PROTECTED_RESERVE" | "HARD_LIMIT";

export interface BudgetSnapshotLike {
  remaining: number;
  protectedRemaining: number;
  usedByCategory: { LIVE: number; [category: string]: number };
}

export interface SupplierBudgetPort {
  consume(input: { category: SupplierRequestCategory; count: number; at: Date }): Promise<
    | { allowed: true; snapshot: BudgetSnapshotLike }
    | { allowed: false; reason: BudgetRejectionReason; snapshot: BudgetSnapshotLike }
  >;
  reconcile(input: { at: Date; supplierLimit: number; supplierRemaining: number }): Promise<BudgetSnapshotLike>;
}

export interface SupplierQuota {
  supplierLimit?: number;
  supplierRemaining?: number;
}

export interface SupplierClientPort<Fixture = unknown, Odds = unknown, Live = unknown> {
  fetchFixtures(input: { leagueId: number; season: number; from: string; to: string }): Promise<{ data: Fixture[]; quota: SupplierQuota }>;
  fetchPrematchOdds(input: { fixtureId: number; bookmakerId: number }): Promise<{ data: Odds | null; quota: SupplierQuota }>;
  fetchLive(input: { fixtureId: number; bookmakerId: number }): Promise<{ data: Live | null; quota: SupplierQuota }>;
  fetchStatus(): Promise<{ supplierCurrent: number; supplierLimit: number }>;
}

export interface MatchSnapshotRepositoryPort<Fixture = unknown, Odds = unknown, Live = unknown> {
  saveFixtures(fixtures: Fixture[]): Promise<void>;
  saveOdds(odds: Odds): Promise<void>;
  saveLive(live: Live): Promise<void>;
  setSyncState(matchId: string, state: "IDLE" | "SYNCING" | "PAUSED" | "FAILED"): Promise<void>;
}

export interface ClockPort { now(): Date }

export type SupplierJob =
  | { type: "FIXTURES"; attempt: number; payload: { leagueId: number; season: number; from: string; to: string } }
  | { type: "RESULTS"; attempt: number; payload: { leagueId: number; season: number; from: string; to: string } }
  | { type: "PREMATCH_ODDS"; attempt: number; payload: { fixtureId: number; matchId: string; bookmakerId: number } }
  | { type: "LIVE"; attempt: number; payload: { fixtureId: number; matchId: string; bookmakerId: number } }
  | { type: "STATUS_CALIBRATE"; attempt: number; payload: Record<string, never> };

export type SupplierJobResult =
  | { outcome: "SUCCESS"; synced: number; nextRunAt?: string }
  | { outcome: "DEFERRED"; reason: "BUDGET_EXHAUSTED" | "PROTECTED_RESERVE"; retryAt: string }
  | { outcome: "RETRY"; reason: "SUPPLIER_FAILURE"; retryAt: string; nextAttempt: number };

type HandlerDependencies<Fixture, Odds, Live> = {
  client: SupplierClientPort<Fixture, Odds, Live>;
  budget: SupplierBudgetPort;
  repository: MatchSnapshotRepositoryPort<Fixture, Odds, Live>;
  clock: ClockPort;
};

function nextUtcDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

function retryAt(now: Date, attempt: number): string {
  const safeAttempt = Math.max(0, Math.min(16, Math.trunc(attempt)));
  const delayMs = Math.min(30 * 60_000, 30_000 * 2 ** safeAttempt);
  return new Date(now.getTime() + delayMs).toISOString();
}

function liveNextRunAt(now: Date, snapshot: BudgetSnapshotLike): string {
  if (snapshot.remaining <= snapshot.protectedRemaining || snapshot.usedByCategory.LIVE >= 70) return nextUtcDay(now);
  const delayMs = snapshot.remaining <= snapshot.protectedRemaining + 5 ? 10 * 60_000 : 5 * 60_000;
  return new Date(now.getTime() + delayMs).toISOString();
}

async function reconcileQuota(dependencies: Pick<HandlerDependencies<unknown, unknown, unknown>, "budget">, now: Date, quota: SupplierQuota, fallback: BudgetSnapshotLike): Promise<BudgetSnapshotLike> {
  if (quota.supplierLimit === undefined || quota.supplierRemaining === undefined) return fallback;
  return dependencies.budget.reconcile({ at: now, supplierLimit: quota.supplierLimit, supplierRemaining: quota.supplierRemaining });
}

async function charge(dependencies: Pick<HandlerDependencies<unknown, unknown, unknown>, "budget">, category: SupplierRequestCategory, now: Date): Promise<
  | { allowed: true; snapshot: BudgetSnapshotLike }
  | { allowed: false; result: SupplierJobResult }
> {
  const decision = await dependencies.budget.consume({ category, count: 1, at: now });
  if (decision.allowed) return decision;
  return {
    allowed: false,
    result: {
      outcome: "DEFERRED",
      reason: decision.reason === "PROTECTED_RESERVE" ? "PROTECTED_RESERVE" : "BUDGET_EXHAUSTED",
      retryAt: nextUtcDay(now),
    },
  };
}

export function createSupplierJobHandler<Fixture, Odds, Live>(dependencies: HandlerDependencies<Fixture, Odds, Live>) {
  return {
    async run(job: SupplierJob): Promise<SupplierJobResult> {
      const now = dependencies.clock.now();
      try {
        if (job.type === "STATUS_CALIBRATE") {
          const status = await dependencies.client.fetchStatus();
          await dependencies.budget.reconcile({
            at: now,
            supplierLimit: status.supplierLimit,
            supplierRemaining: Math.max(0, status.supplierLimit - status.supplierCurrent),
          });
          return { outcome: "SUCCESS", synced: 0 };
        }

        if (job.type === "FIXTURES" || job.type === "RESULTS") {
          const budget = await charge(dependencies, job.type === "RESULTS" ? "SETTLEMENT" : "STATIC", now);
          if (!budget.allowed) return budget.result;
          const response = await dependencies.client.fetchFixtures(job.payload);
          await reconcileQuota(dependencies, now, response.quota, budget.snapshot);
          await dependencies.repository.saveFixtures(response.data);
          return { outcome: "SUCCESS", synced: response.data.length };
        }

        if (job.type === "PREMATCH_ODDS") {
          await dependencies.repository.setSyncState(job.payload.matchId, "SYNCING");
          const budget = await charge(dependencies, "PREMATCH_ODDS", now);
          if (!budget.allowed) {
            await dependencies.repository.setSyncState(job.payload.matchId, "PAUSED");
            return budget.result;
          }
          const response = await dependencies.client.fetchPrematchOdds(job.payload);
          await reconcileQuota(dependencies, now, response.quota, budget.snapshot);
          if (response.data === null) throw new Error("Supplier returned no prematch odds");
          await dependencies.repository.saveOdds(response.data);
          await dependencies.repository.setSyncState(job.payload.matchId, "IDLE");
          return { outcome: "SUCCESS", synced: 1 };
        }

        const budget = await charge(dependencies, "LIVE", now);
        if (!budget.allowed) return budget.result;
        const response = await dependencies.client.fetchLive(job.payload);
        const snapshot = await reconcileQuota(dependencies, now, response.quota, budget.snapshot);
        if (response.data === null) throw new Error("Supplier returned no live data");
        await dependencies.repository.saveLive(response.data);
        return { outcome: "SUCCESS", synced: 1, nextRunAt: liveNextRunAt(now, snapshot) };
      } catch {
        if (job.type === "PREMATCH_ODDS") await dependencies.repository.setSyncState(job.payload.matchId, "FAILED");
        return { outcome: "RETRY", reason: "SUPPLIER_FAILURE", retryAt: retryAt(now, job.attempt), nextAttempt: job.attempt + 1 };
      }
    },
  };
}
