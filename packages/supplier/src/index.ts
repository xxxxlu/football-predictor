import { createHash } from "node:crypto";
import {
  createMatchView,
  localizeCompetitionName,
  localizeTeamName,
  type BudgetSnapshot,
  type FixtureSnapshot,
  type LiveSnapshot,
  type MatchView,
  type OddsSnapshot,
  type SupplierBudgetPort,
  type SupplierRequestCategory,
  type SyncState,
} from "@football-predictor/domain";

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

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type OpenLigaDbMatch = {
  matchID: number;
  leagueId: number;
  leagueName: string;
  leagueSeason: number;
  leagueShortcut: string;
  matchDateTimeUTC: string;
  lastUpdateDateTime?: string;
  matchIsFinished: boolean;
  team1: { teamId: number; teamName: string; shortName?: string };
  team2: { teamId: number; teamName: string; shortName?: string };
  matchResults?: Array<{ resultTypeID: number; pointsTeam1: number; pointsTeam2: number }>;
};

function validDate(value: string | undefined, fallback: Date): string {
  const parsed = value ? new Date(value) : fallback;
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback.toISOString();
}

export class OpenLigaDbClient {
  private readonly fetcher: Fetcher;
  private readonly now: () => Date;
  private readonly baseUrl: string;

  constructor(input: { fetcher?: Fetcher; now?: () => Date; baseUrl?: string } = {}) {
    this.fetcher = input.fetcher ?? fetch;
    this.now = input.now ?? (() => new Date());
    this.baseUrl = (input.baseUrl ?? "https://api.openligadb.de").replace(/\/$/, "");
  }

  async fetchWorldCup2026(): Promise<FixtureSnapshot[]> {
    const response = await this.fetcher(`${this.baseUrl}/getmatchdata/wm26/2026`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) throw new Error(`OpenLigaDB request failed: HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("OpenLigaDB request failed: invalid payload");
    const capturedAt = this.now();
    return (payload as OpenLigaDbMatch[]).flatMap((item) => {
      if (!Number.isSafeInteger(item.matchID) || !item.team1 || !item.team2) return [];
      const kickoffAt = validDate(item.matchDateTimeUTC, capturedAt);
      const dataAsOf = validDate(item.lastUpdateDateTime, capturedAt);
      const finalResult = item.matchResults?.find((result) => result.resultTypeID === 2);
      const status = item.matchIsFinished ? "FINISHED" as const : new Date(kickoffAt) <= capturedAt ? "LIVE" as const : "SCHEDULED" as const;
      const result = {
        confirmed: item.matchIsFinished && Boolean(finalResult),
        homeScore: finalResult?.pointsTeam1 ?? null,
        awayScore: finalResult?.pointsTeam2 ?? null,
        version: item.matchIsFinished && finalResult ? etagOf({ matchID: item.matchID, finalResult }).slice(1, -1) : null,
      };
      const fixtureWithoutVersion: Omit<FixtureSnapshot, "version"> = {
        id: `openligadb:${item.matchID}`,
        supplier: "OPENLIGADB",
        supplierFixtureId: item.matchID,
        competitionId: item.leagueId,
        competitionName: localizeCompetitionName(item.leagueName),
        season: item.leagueSeason,
        kickoffAt,
        status,
        homeTeam: { supplierTeamId: item.team1.teamId, name: localizeTeamName(item.team1.teamName, item.team1.shortName) },
        awayTeam: { supplierTeamId: item.team2.teamId, name: localizeTeamName(item.team2.teamName, item.team2.shortName) },
        dataAsOf,
        capturedAt: capturedAt.toISOString(),
        result,
      };
      return [{ ...fixtureWithoutVersion, version: etagOf(fixtureWithoutVersion).slice(1, -1) }];
    });
  }
}

function platformPredictionMarket(fixture: FixtureSnapshot, now: Date): OddsSnapshot {
  const outcomes = [
    { selection: "HOME" as const, supplierLabel: "主胜", decimalOdds: "3.00" },
    { selection: "DRAW" as const, supplierLabel: "平局", decimalOdds: "3.00" },
    { selection: "AWAY" as const, supplierLabel: "客胜", decimalOdds: "3.00" },
  ];
  return {
    productMarketId: `${fixture.id}:bookmaker:0:market:1`, fixtureId: fixture.id, supplier: "PLATFORM",
    supplierFixtureId: fixture.supplierFixtureId, bookmakerId: 0, bookmakerName: "平台固定虚拟积分", marketId: 1,
    marketName: "胜平负固定积分倍率", version: etagOf({ fixtureId: fixture.id, outcomes, dataAsOf: now.toISOString() }).slice(1, -1),
    dataAsOf: now.toISOString(), capturedAt: now.toISOString(), outcomes,
  };
}

export class OpenLigaDbWorldCupSync {
  private readonly repository: Pick<MatchSnapshotRepository, "saveFixtures" | "saveOdds">;
  private readonly client: OpenLigaDbClient;
  private readonly now: () => Date;

  constructor(input: { repository: Pick<MatchSnapshotRepository, "saveFixtures" | "saveOdds">; client?: OpenLigaDbClient; now?: () => Date }) {
    this.repository = input.repository;
    this.client = input.client ?? new OpenLigaDbClient();
    this.now = input.now ?? (() => new Date());
  }

  async run(): Promise<{ fixturesSynced: number; marketsSynced: number }> {
    const now = this.now();
    const recentCutoff = now.getTime() - 24 * 60 * 60_000;
    const fixtures = (await this.client.fetchWorldCup2026()).filter((fixture) => new Date(fixture.kickoffAt).getTime() >= recentCutoff);
    await this.repository.saveFixtures(fixtures);
    const upcoming = fixtures.filter((fixture) => fixture.status === "SCHEDULED" && new Date(fixture.kickoffAt) > now);
    for (const fixture of upcoming) await this.repository.saveOdds(platformPredictionMarket(fixture, now));
    return { fixturesSynced: fixtures.length, marketsSynced: upcoming.length };
  }
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
