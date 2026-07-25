import { createHash } from "node:crypto";
import {
  CORRECT_SCORE_OTHER,
  CORRECT_SCORE_SELECTIONS,
  CORRECT_SCORE_SUPPLIER_MARKET_ID,
  ONE_X_TWO_SUPPLIER_MARKET_ID,
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
  type LineupSnapshot,
} from "@pulse/domain";

export * from "./lineups.js";

export interface MatchSnapshotRepository {
  saveFixtures(fixtures: FixtureSnapshot[]): Promise<void>;
  saveOdds(odds: OddsSnapshot): Promise<void>;
  saveLive(live: LiveSnapshot): Promise<void>;
  getFixture(matchId: string): Promise<FixtureSnapshot | null>;
  listFixtures(): Promise<FixtureSnapshot[]>;
  getOdds(matchId: string): Promise<OddsSnapshot | null>;
  getCorrectScoreOdds(matchId: string): Promise<OddsSnapshot | null>;
  getLive(matchId: string): Promise<LiveSnapshot | null>;
  getLineup?(matchId: string): Promise<import("@pulse/domain").LineupSnapshot | null>;
  saveLineup?(snapshot: import("@pulse/domain").LineupSnapshot): Promise<void>;
  setSyncState(matchId: string, state: SyncState): Promise<void>;
  getSyncState(matchId: string): Promise<SyncState>;
  /** Optional bulk projection used by list reads; avoids one query fan-out per fixture. */
  listViewData?(): Promise<MatchViewData[]>;
  /** Optional aggregate over the fixture cache used for freshness metadata on list reads. */
  getFreshness?(): Promise<SupplierFreshness>;
  claimExternalSync(key: string, at: Date, minimumIntervalMs: number): Promise<boolean>;
}

export interface SupplierFreshness {
  /** Newest captured_at across all cached fixtures, or null when the cache is empty. */
  lastCapturedAt: string | null;
  /** Kickoff of the next future SCHEDULED fixture, or null when none exists. */
  nextKickoffAt: string | null;
  /** Competition name of that next fixture, or null when none exists. */
  nextKickoffCompetition: string | null;
  upcomingCount: number;
  liveCount: number;
  finishedRecentCount: number;
}

export interface MatchViewData {
  fixture: FixtureSnapshot;
  odds: OddsSnapshot | null;
  correctScoreOdds: OddsSnapshot | null;
  live: LiveSnapshot | null;
  lineup: LineupSnapshot | null;
  syncState: SyncState;
}

export interface SupplierGateway {
  fetchFixtures(input: { leagueId: number; season: number; from: string; to: string }): Promise<{ data: FixtureSnapshot[]; quota: { supplierLimit?: number; supplierRemaining?: number } }>;
  fetchPrematchOdds(input: { fixtureId: number; bookmakerId: number }): Promise<{ data: OddsSnapshot | null; quota: { supplierLimit?: number; supplierRemaining?: number } }>;
  fetchLive(input: { fixtureId: number; bookmakerId: number }): Promise<{ data: LiveSnapshot | null; quota: { supplierLimit?: number; supplierRemaining?: number } }>;
  fetchStatus?(): Promise<{ supplierCurrent: number; supplierLimit: number }>;
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export const REAL_ODDS_SYNC_INTERVAL_MS = 2 * 60 * 60_000;

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

type TheOddsApiEvent = {
  id?: unknown;
  commence_time?: unknown;
  home_team?: unknown;
  away_team?: unknown;
  bookmakers?: unknown;
};

export interface RealOddsQuote {
  eventId: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  bookmakerId: number;
  bookmakerName: string;
  dataAsOf: string;
  outcomes: OddsSnapshot["outcomes"];
}

export interface RealOddsClient {
  fetchOdds(sportKey: string): Promise<RealOddsQuote[]>;
  fetchWorldCupOdds?(): Promise<RealOddsQuote[]>;
}

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
    return this.fetchLeague("wm26", 2026);
  }

  async fetchLeague(shortcut: string, season: number): Promise<FixtureSnapshot[]> {
    const response = await this.fetcher(`${this.baseUrl}/getmatchdata/${encodeURIComponent(shortcut)}/${season}`, {
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

function stablePositiveInteger(value: string): number {
  return (Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16) % 2_147_483_646) + 1;
}

function decimalPrice(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 1 ? value.toFixed(2) : null;
}

function quoteFromEvent(event: TheOddsApiEvent, capturedAt: Date): RealOddsQuote | null {
  if (typeof event.id !== "string" || typeof event.commence_time !== "string" || typeof event.home_team !== "string" || typeof event.away_team !== "string" || !Array.isArray(event.bookmakers)) return null;
  const commenceTime = validDate(event.commence_time, capturedAt);
  for (const rawBookmaker of event.bookmakers) {
    if (!rawBookmaker || typeof rawBookmaker !== "object") continue;
    const bookmaker = rawBookmaker as { key?: unknown; title?: unknown; last_update?: unknown; markets?: unknown };
    if (typeof bookmaker.key !== "string" || typeof bookmaker.title !== "string" || !Array.isArray(bookmaker.markets)) continue;
    const market = bookmaker.markets.find((candidate) => candidate && typeof candidate === "object" && (candidate as { key?: unknown }).key === "h2h") as { outcomes?: unknown } | undefined;
    if (!market || !Array.isArray(market.outcomes)) continue;
    const priceByName = new Map<string, string>();
    for (const rawOutcome of market.outcomes) {
      if (!rawOutcome || typeof rawOutcome !== "object") continue;
      const outcome = rawOutcome as { name?: unknown; price?: unknown };
      const price = decimalPrice(outcome.price);
      if (typeof outcome.name === "string" && price) priceByName.set(outcome.name, price);
    }
    const home = priceByName.get(event.home_team);
    const draw = priceByName.get("Draw");
    const away = priceByName.get(event.away_team);
    if (!home || !draw || !away) continue;
    return {
      eventId: event.id,
      commenceTime,
      homeTeam: localizeTeamName(event.home_team),
      awayTeam: localizeTeamName(event.away_team),
      bookmakerId: stablePositiveInteger(bookmaker.key),
      bookmakerName: bookmaker.title,
      dataAsOf: validDate(typeof bookmaker.last_update === "string" ? bookmaker.last_update : undefined, capturedAt),
      outcomes: [
        { selection: "HOME", supplierLabel: event.home_team, decimalOdds: home },
        { selection: "DRAW", supplierLabel: "Draw", decimalOdds: draw },
        { selection: "AWAY", supplierLabel: event.away_team, decimalOdds: away },
      ],
    };
  }
  return null;
}

export class TheOddsApiClient implements RealOddsClient {
  private readonly apiKey: string;
  private readonly fetcher: Fetcher;
  private readonly now: () => Date;
  private readonly baseUrl: string;

  constructor(input: { apiKey: string; fetcher?: Fetcher; now?: () => Date; baseUrl?: string }) {
    this.apiKey = input.apiKey;
    this.fetcher = input.fetcher ?? fetch;
    this.now = input.now ?? (() => new Date());
    this.baseUrl = (input.baseUrl ?? "https://api.the-odds-api.com/v4").replace(/\/$/, "");
  }

  async fetchWorldCupOdds(): Promise<RealOddsQuote[]> {
    return this.fetchOdds("soccer_fifa_world_cup");
  }

  async fetchOdds(sportKey: string): Promise<RealOddsQuote[]> {
    const url = new URL(`${this.baseUrl}/sports/${encodeURIComponent(sportKey)}/odds`);
    url.searchParams.set("apiKey", this.apiKey);
    url.searchParams.set("regions", "eu");
    url.searchParams.set("markets", "h2h");
    url.searchParams.set("oddsFormat", "decimal");
    url.searchParams.set("dateFormat", "iso");
    const response = await this.fetcher(url, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(6_000) });
    if (!response.ok) throw new Error(`The Odds API request failed: HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("The Odds API request failed: invalid payload");
    const capturedAt = this.now();
    return (payload as TheOddsApiEvent[]).flatMap((event) => {
      const quote = quoteFromEvent(event, capturedAt);
      return quote ? [quote] : [];
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

/** Platform-fixed virtual correct-score odds. Not real bookmaker prices; see PRD Correct Score contract. */
const CORRECT_SCORE_ODDS: Readonly<Record<string, string>> = {
  "0-0": "8.00", "1-0": "7.00", "0-1": "7.00", "1-1": "6.00",
  "2-0": "9.00", "0-2": "9.00", "2-1": "8.00", "1-2": "8.00",
  "2-2": "12.00", "3-0": "15.00", "0-3": "15.00", "3-1": "15.00",
  "1-3": "15.00", "3-2": "20.00", "2-3": "20.00", "3-3": "28.00",
  [CORRECT_SCORE_OTHER]: "5.00",
};

function correctScoreMarket(fixture: FixtureSnapshot, now: Date): OddsSnapshot {
  const outcomes = [...CORRECT_SCORE_SELECTIONS, CORRECT_SCORE_OTHER].map((selection) => ({
    selection,
    supplierLabel: selection === CORRECT_SCORE_OTHER ? "其他比分" : selection,
    decimalOdds: CORRECT_SCORE_ODDS[selection] ?? "5.00",
  }));
  return {
    productMarketId: `${fixture.id}:bookmaker:0:market:${CORRECT_SCORE_SUPPLIER_MARKET_ID}`, fixtureId: fixture.id, supplier: "PLATFORM",
    supplierFixtureId: fixture.supplierFixtureId, bookmakerId: 0, bookmakerName: "平台固定虚拟积分", marketId: CORRECT_SCORE_SUPPLIER_MARKET_ID,
    marketName: "正确比分固定积分倍率", version: etagOf({ fixtureId: fixture.id, marketId: CORRECT_SCORE_SUPPLIER_MARKET_ID, outcomes }).slice(1, -1),
    dataAsOf: now.toISOString(), capturedAt: now.toISOString(), outcomes,
  };
}

export interface SyncCompetition {
  /** OpenLigaDB league shortcut, e.g. "wm26" or "bl1". */
  shortcut: string;
  /** OpenLigaDB season, e.g. 2026 for the 2026/27 season. */
  season: number;
  /** The-Odds-API sport key for real 1X2 odds. Omit for competitions without a reliable market (platform odds only). */
  oddsSportKey?: string;
}

/** Historical default: the sync originally covered only the FIFA World Cup 2026. */
export const DEFAULT_SYNC_COMPETITIONS: readonly SyncCompetition[] = [
  { shortcut: "wm26", season: 2026, oddsSportKey: "soccer_fifa_world_cup" },
];

export interface CompetitionSyncResult {
  fixturesSynced: number;
  marketsSynced: number;
  oddsRequestMade: boolean;
  /** Fixture count per successfully fetched competition, keyed by "<shortcut>/<season>". */
  fixturesByCompetition: Record<string, number>;
  /** Number of per-competition fixture fetches (or per-sport odds fetches) that failed and were skipped. */
  fetchErrorCount: number;
}

export class OpenLigaDbCompetitionSync {
  private readonly repository: Pick<MatchSnapshotRepository, "saveFixtures" | "saveOdds" | "getOdds" | "getCorrectScoreOdds" | "claimExternalSync">;
  private readonly client: OpenLigaDbClient;
  private readonly oddsClient: RealOddsClient | undefined;
  private readonly competitions: readonly SyncCompetition[];
  private readonly now: () => Date;

  constructor(input: { repository: Pick<MatchSnapshotRepository, "saveFixtures" | "saveOdds" | "getOdds" | "getCorrectScoreOdds" | "claimExternalSync">; client?: OpenLigaDbClient; oddsClient?: RealOddsClient; competitions?: SyncCompetition[]; now?: () => Date }) {
    this.repository = input.repository;
    this.client = input.client ?? new OpenLigaDbClient();
    this.oddsClient = input.oddsClient;
    this.competitions = input.competitions?.length ? input.competitions : DEFAULT_SYNC_COMPETITIONS;
    this.now = input.now ?? (() => new Date());
  }

  async run(): Promise<CompetitionSyncResult> {
    const now = this.now();
    const fixturesByCompetition: Record<string, number> = {};
    let fetchErrorCount = 0;
    const fetched: Array<{ competition: SyncCompetition; fixtures: FixtureSnapshot[] }> = [];
    for (const competition of this.competitions) {
      try {
        const fixtures = await this.client.fetchLeague(competition.shortcut, competition.season);
        fixturesByCompetition[`${competition.shortcut}/${competition.season}`] = fixtures.length;
        fetched.push({ competition, fixtures });
      } catch {
        // One dead league must not kill the whole sync; count it and continue.
        fetchErrorCount += 1;
      }
    }
    if (fetched.length === 0 && fetchErrorCount > 0) {
      throw new Error(`OpenLigaDB sync failed: all ${fetchErrorCount} competition fetches failed`);
    }
    const allFixtures = fetched.flatMap((entry) => entry.fixtures);
    await this.repository.saveFixtures(allFixtures);
    const isUpcoming = (fixture: FixtureSnapshot) => fixture.status === "SCHEDULED" && new Date(fixture.kickoffAt) > now;
    const upcoming = allFixtures.filter(isUpcoming);
    if (!this.oddsClient) {
      for (const fixture of upcoming) {
        await this.repository.saveOdds(platformPredictionMarket(fixture, now));
        if (!(await this.repository.getCorrectScoreOdds(fixture.id))) await this.repository.saveOdds(correctScoreMarket(fixture, now));
      }
      return { fixturesSynced: allFixtures.length, marketsSynced: upcoming.length, oddsRequestMade: false, fixturesByCompetition, fetchErrorCount };
    }
    for (const fixture of upcoming) {
      if (!(await this.repository.getOdds(fixture.id))) await this.repository.saveOdds(platformPredictionMarket(fixture, now));
      if (!(await this.repository.getCorrectScoreOdds(fixture.id))) await this.repository.saveOdds(correctScoreMarket(fixture, now));
    }
    // Fetch real odds once per distinct sport key, matched only against the upcoming fixtures of that key's competitions.
    const upcomingBySportKey = new Map<string, FixtureSnapshot[]>();
    for (const entry of fetched) {
      const sportKey = entry.competition.oddsSportKey;
      if (!sportKey) continue;
      const upcomingFixtures = entry.fixtures.filter(isUpcoming);
      if (upcomingFixtures.length === 0) continue;
      upcomingBySportKey.set(sportKey, [...(upcomingBySportKey.get(sportKey) ?? []), ...upcomingFixtures]);
    }
    let marketsSynced = 0;
    let oddsRequestMade = false;
    for (const [sportKey, sportUpcoming] of upcomingBySportKey) {
      if (!(await this.repository.claimExternalSync(`the-odds-api:${sportKey}:h2h:eu`, now, REAL_ODDS_SYNC_INTERVAL_MS))) continue;
      let quotes: RealOddsQuote[];
      try {
        quotes = await this.oddsClient.fetchOdds(sportKey);
        oddsRequestMade = true;
      } catch {
        fetchErrorCount += 1;
        continue;
      }
      for (const fixture of sportUpcoming) {
        const quote = quotes.find((candidate) => candidate.homeTeam === fixture.homeTeam.name && candidate.awayTeam === fixture.awayTeam.name && Math.abs(new Date(candidate.commenceTime).getTime() - new Date(fixture.kickoffAt).getTime()) <= 3 * 60 * 60_000);
        if (!quote) continue;
        const capturedAt = now.toISOString();
        const marketWithoutVersion = {
          productMarketId: `${fixture.id}:bookmaker:${quote.bookmakerId}:market:1`, fixtureId: fixture.id, supplier: "THE_ODDS_API" as const,
          supplierFixtureId: fixture.supplierFixtureId, bookmakerId: quote.bookmakerId, bookmakerName: quote.bookmakerName, marketId: 1,
          marketName: "胜平负真实赔率", dataAsOf: quote.dataAsOf, capturedAt, outcomes: quote.outcomes,
        };
        await this.repository.saveOdds({ ...marketWithoutVersion, version: etagOf(marketWithoutVersion).slice(1, -1) });
        marketsSynced += 1;
      }
    }
    return { fixturesSynced: allFixtures.length, marketsSynced, oddsRequestMade, fixturesByCompetition, fetchErrorCount };
  }
}

/** Back-compat alias: the sync used to be World Cup 2026 only. */
export const OpenLigaDbWorldCupSync = OpenLigaDbCompetitionSync;
export type OpenLigaDbWorldCupSync = OpenLigaDbCompetitionSync;

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
  private lineups = new Map<string, import("@pulse/domain").LineupSnapshot>();
  private syncStates = new Map<string, SyncState>();
  private externalSyncs = new Map<string, number>();
  private readonly now: () => Date;

  constructor(input: { now?: () => Date } = {}) { this.now = input.now ?? (() => new Date()); }

  async getFreshness(): Promise<SupplierFreshness> {
    const now = this.now();
    const fixtures = [...this.fixtures.values()];
    const upcoming = fixtures
      .filter((fixture) => fixture.status === "SCHEDULED" && new Date(fixture.kickoffAt) > now)
      .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
    const next = upcoming[0] ?? null;
    const finishedCutoff = now.getTime() - 14 * 24 * 60 * 60_000;
    return {
      lastCapturedAt: fixtures.map((fixture) => fixture.capturedAt).sort().at(-1) ?? null,
      nextKickoffAt: next?.kickoffAt ?? null,
      nextKickoffCompetition: next?.competitionName ?? null,
      upcomingCount: upcoming.length,
      liveCount: fixtures.filter((fixture) => fixture.status === "LIVE").length,
      finishedRecentCount: fixtures.filter((fixture) => fixture.status === "FINISHED" && new Date(fixture.kickoffAt).getTime() >= finishedCutoff).length,
    };
  }

  async saveFixtures(fixtures: FixtureSnapshot[]): Promise<void> { for (const fixture of fixtures) this.fixtures.set(fixture.id, structuredClone(fixture)); }
  async saveOdds(odds: OddsSnapshot): Promise<void> { this.odds.set(`${odds.fixtureId}:${odds.marketId}`, structuredClone(odds)); }
  async saveLive(live: LiveSnapshot): Promise<void> { this.live.set(live.fixtureId, structuredClone(live)); }
  async getFixture(matchId: string): Promise<FixtureSnapshot | null> { return structuredClone(this.fixtures.get(matchId) ?? null); }
  async listFixtures(): Promise<FixtureSnapshot[]> { return [...this.fixtures.values()].sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt)).map((fixture) => structuredClone(fixture)); }
  async getOdds(matchId: string): Promise<OddsSnapshot | null> { return structuredClone(this.odds.get(`${matchId}:${ONE_X_TWO_SUPPLIER_MARKET_ID}`) ?? null); }
  async getCorrectScoreOdds(matchId: string): Promise<OddsSnapshot | null> { return structuredClone(this.odds.get(`${matchId}:${CORRECT_SCORE_SUPPLIER_MARKET_ID}`) ?? null); }
  async getLive(matchId: string): Promise<LiveSnapshot | null> { return structuredClone(this.live.get(matchId) ?? null); }
  async saveLineup(snapshot: import("@pulse/domain").LineupSnapshot): Promise<void> { this.lineups.set(snapshot.fixtureId, structuredClone(snapshot)); }
  async getLineup(matchId: string): Promise<import("@pulse/domain").LineupSnapshot | null> { return structuredClone(this.lineups.get(matchId) ?? null); }
  async setSyncState(matchId: string, state: SyncState): Promise<void> { this.syncStates.set(matchId, state); }
  async getSyncState(matchId: string): Promise<SyncState> { return this.syncStates.get(matchId) ?? "IDLE"; }
  async claimExternalSync(key: string, at: Date, minimumIntervalMs: number): Promise<boolean> {
    const previous = this.externalSyncs.get(key);
    if (previous !== undefined && at.getTime() - previous < minimumIntervalMs) return false;
    this.externalSyncs.set(key, at.getTime());
    return true;
  }
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
    const [odds, correctScoreOdds, live, lineup, syncState] = await Promise.all([this.repository.getOdds(fixture.id), this.repository.getCorrectScoreOdds(fixture.id), this.repository.getLive(fixture.id), this.repository.getLineup?.(fixture.id) ?? Promise.resolve(null), this.repository.getSyncState(fixture.id)]);
    return createMatchView({ now: this.now(), fixture, odds, correctScoreOdds, live, lineup, syncState, sourceVerified: syncState !== "FAILED", budgetAvailable: syncState !== "PAUSED" });
  }

  async get(matchId: string): Promise<{ view: MatchView; etag: string }> {
    const fixture = await this.repository.getFixture(matchId);
    if (!fixture) throw Object.assign(new Error("Match cache is unavailable"), { code: "CACHE_UNAVAILABLE" });
    const view = await this.viewFor(fixture);
    return { view, etag: etagOf(view) };
  }

  async list(): Promise<{ views: MatchView[]; etag: string }> {
    if (this.repository.listViewData) {
      const now = this.now();
      const data = await this.repository.listViewData();
      const views = data.map((item) => createMatchView({
        ...item,
        now,
        sourceVerified: item.syncState !== "FAILED",
        budgetAvailable: item.syncState !== "PAUSED",
      }));
      return { views, etag: etagOf(views) };
    }
    const fixtures = await this.repository.listFixtures();
    const views = await Promise.all(fixtures.map((fixture) => this.viewFor(fixture)));
    return { views, etag: etagOf(views) };
  }
}
