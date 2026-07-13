import { createHash } from "node:crypto";
import { createMatchView, type FixtureSnapshot, type LiveSnapshot, type MatchView, type OddsSnapshot, type SyncState } from "../../domain/src/competition/index.js";
import type { BudgetSnapshot, SupplierBudgetPort, SupplierRequestCategory } from "../../domain/src/supplier-budget/index.js";

export interface MatchSnapshotRepository {
  saveFixtures(fixtures: FixtureSnapshot[]): Promise<void>;
  saveOdds(odds: OddsSnapshot): Promise<void>;
  saveLive(live: LiveSnapshot): Promise<void>;
  getFixture(matchId: string): Promise<FixtureSnapshot | null>;
  listFixtures(): Promise<FixtureSnapshot[]>;
  getOdds(matchId: string): Promise<OddsSnapshot | null>;
  getLive(matchId: string): Promise<LiveSnapshot | null>;
  setSyncState(matchId: string, state: SyncState): Promise<void>;
  getSyncState(matchId: string): Promise<SyncState>;
}

export interface SupplierGateway {
  fetchFixtures(input: { leagueId: number; season: number; from: string; to: string }): Promise<{ data: FixtureSnapshot[]; quota: { supplierLimit?: number; supplierRemaining?: number } }>;
  fetchPrematchOdds(input: { fixtureId: number; bookmakerId: number }): Promise<{ data: OddsSnapshot | null; quota: { supplierLimit?: number; supplierRemaining?: number } }>;
  fetchLive(input: { fixtureId: number; bookmakerId: number }): Promise<{ data: LiveSnapshot | null; quota: { supplierLimit?: number; supplierRemaining?: number } }>;
  fetchStatus?(): Promise<{ supplierCurrent: number; supplierLimit: number }>;
}

export class SupplierSyncError extends Error {
  constructor(readonly code: "SUPPLIER_BUDGET_EXHAUSTED" | "SUPPLIER_DATA_UNAVAILABLE", message: string) {
    super(message);
    this.name = "SupplierSyncError";
  }
}

export class InMemoryMatchSnapshotRepository implements MatchSnapshotRepository {
  private fixtures = new Map<string, FixtureSnapshot>();
  private odds = new Map<string, OddsSnapshot>();
  private live = new Map<string, LiveSnapshot>();
  private syncStates = new Map<string, SyncState>();

  async saveFixtures(fixtures: FixtureSnapshot[]): Promise<void> { for (const fixture of fixtures) this.fixtures.set(fixture.id, structuredClone(fixture)); }
  async saveOdds(odds: OddsSnapshot): Promise<void> { this.odds.set(odds.fixtureId, structuredClone(odds)); }
  async saveLive(live: LiveSnapshot): Promise<void> { this.live.set(live.fixtureId, structuredClone(live)); }
  async getFixture(matchId: string): Promise<FixtureSnapshot | null> { return structuredClone(this.fixtures.get(matchId) ?? null); }
  async listFixtures(): Promise<FixtureSnapshot[]> { return [...this.fixtures.values()].sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt)).map((fixture) => structuredClone(fixture)); }
  async getOdds(matchId: string): Promise<OddsSnapshot | null> { return structuredClone(this.odds.get(matchId) ?? null); }
  async getLive(matchId: string): Promise<LiveSnapshot | null> { return structuredClone(this.live.get(matchId) ?? null); }
  async setSyncState(matchId: string, state: SyncState): Promise<void> { this.syncStates.set(matchId, state); }
  async getSyncState(matchId: string): Promise<SyncState> { return this.syncStates.get(matchId) ?? "IDLE"; }
}

async function reconcileQuota(budget: SupplierBudgetPort, at: Date, quota: { supplierLimit?: number; supplierRemaining?: number }): Promise<void> {
  if (quota.supplierLimit !== undefined && quota.supplierRemaining !== undefined) {
    await budget.reconcile({ at, supplierLimit: quota.supplierLimit, supplierRemaining: quota.supplierRemaining });
  }
}

export class SupplierSyncService {
  private readonly repository: MatchSnapshotRepository;
  private readonly budget: SupplierBudgetPort;
  private readonly gateway: SupplierGateway;
  private readonly now: () => Date;

  constructor(input: { repository: MatchSnapshotRepository; budget: SupplierBudgetPort; gateway: SupplierGateway; now?: () => Date }) {
    this.repository = input.repository;
    this.budget = input.budget;
    this.gateway = input.gateway;
    this.now = input.now ?? (() => new Date());
  }

  private async charge(category: SupplierRequestCategory): Promise<Date> {
    const at = this.now();
    const decision = await this.budget.consume({ category, count: 1, at });
    if (!decision.allowed) throw new SupplierSyncError("SUPPLIER_BUDGET_EXHAUSTED", `Supplier ${category} budget is exhausted`);
    return at;
  }

  async syncFixtures(input: { leagueId: number; season: number; from: string; to: string }): Promise<{ synced: number }> {
    const at = await this.charge("STATIC");
    const result = await this.gateway.fetchFixtures(input);
    await reconcileQuota(this.budget, at, result.quota);
    await this.repository.saveFixtures(result.data);
    return { synced: result.data.length };
  }

  async syncPrematchOdds(input: { fixtureId: number; matchId: string; bookmakerId: number }): Promise<{ synced: boolean }> {
    await this.repository.setSyncState(input.matchId, "SYNCING");
    try {
      const at = await this.charge("PREMATCH_ODDS");
      const result = await this.gateway.fetchPrematchOdds(input);
      await reconcileQuota(this.budget, at, result.quota);
      if (!result.data) throw new SupplierSyncError("SUPPLIER_DATA_UNAVAILABLE", "Supplier returned no 1X2 odds");
      await this.repository.saveOdds(result.data);
      await this.repository.setSyncState(input.matchId, "IDLE");
      return { synced: true };
    } catch (error) {
      await this.repository.setSyncState(input.matchId, error instanceof SupplierSyncError && error.code === "SUPPLIER_BUDGET_EXHAUSTED" ? "PAUSED" : "FAILED");
      throw error;
    }
  }

  async syncLive(input: { fixtureId: number; matchId: string; bookmakerId: number }): Promise<{ synced: boolean }> {
    const at = await this.charge("LIVE");
    const result = await this.gateway.fetchLive(input);
    await reconcileQuota(this.budget, at, result.quota);
    if (!result.data) return { synced: false };
    await this.repository.saveLive(result.data);
    return { synced: true };
  }

  async calibrateBudget(): Promise<BudgetSnapshot> {
    if (!this.gateway.fetchStatus) throw new SupplierSyncError("SUPPLIER_DATA_UNAVAILABLE", "Supplier status calibration is not configured");
    const at = this.now();
    const status = await this.gateway.fetchStatus();
    return this.budget.reconcile({ at, supplierLimit: status.supplierLimit, supplierRemaining: Math.max(0, status.supplierLimit - status.supplierCurrent) });
  }
}

export function planNextLiveSync(input: { liveUsed: number; remaining: number; protectedRemaining: number }):
  | { action: "SYNC"; delayMs: number }
  | { action: "PAUSE"; delayMs: null } {
  if (input.liveUsed >= 70 || input.remaining <= input.protectedRemaining) {
    return { action: "PAUSE", delayMs: null };
  }
  return { action: "SYNC", delayMs: input.remaining <= input.protectedRemaining + 5 ? 10 * 60_000 : 5 * 60_000 };
}

function etagOf(value: unknown): string { return `"${createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`; }

export class MatchCacheReader {
  private readonly repository: MatchSnapshotRepository;
  private readonly now: () => Date;
  constructor(input: { repository: MatchSnapshotRepository; now?: () => Date }) { this.repository = input.repository; this.now = input.now ?? (() => new Date()); }

  private async viewFor(fixture: FixtureSnapshot): Promise<MatchView> {
    const [odds, live, syncState] = await Promise.all([this.repository.getOdds(fixture.id), this.repository.getLive(fixture.id), this.repository.getSyncState(fixture.id)]);
    return createMatchView({ now: this.now(), fixture, odds, live, syncState, sourceVerified: syncState !== "FAILED", budgetAvailable: syncState !== "PAUSED" });
  }

  async get(matchId: string): Promise<{ view: MatchView; etag: string }> {
    const fixture = await this.repository.getFixture(matchId);
    if (!fixture) throw Object.assign(new Error("Match cache is unavailable"), { code: "CACHE_UNAVAILABLE" });
    const view = await this.viewFor(fixture);
    return { view, etag: etagOf(view) };
  }

  async list(): Promise<{ views: MatchView[]; etag: string }> {
    const fixtures = await this.repository.listFixtures();
    const views = await Promise.all(fixtures.map((fixture) => this.viewFor(fixture)));
    return { views, etag: etagOf(views) };
  }
}
