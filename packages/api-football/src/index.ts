import { createHash } from "node:crypto";
import type { FixtureSnapshot, LiveSnapshot, MatchStatus, OddsSnapshot, Selection } from "@football-predictor/domain";

export interface QuotaHeaders { supplierLimit?: number; supplierRemaining?: number }
export interface SupplierResult<T> { data: T; quota: QuotaHeaders }
export interface SupplierPageResult<T> extends SupplierResult<T> { paging: { current: number; total: number } }

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetcher?: Fetcher;
  now?: () => Date;
}

function versionOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function statusFrom(short: string): MatchStatus {
  if (["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"].includes(short)) return "LIVE";
  if (["FT", "AET", "PEN"].includes(short)) return "FINISHED";
  if (short === "PST") return "POSTPONED";
  if (["CANC", "ABD", "AWD", "WO"].includes(short)) return "CANCELLED";
  return "SCHEDULED";
}

function selectionFrom(value: string): Selection | null {
  if (value === "Home") return "HOME";
  if (value === "Draw") return "DRAW";
  if (value === "Away") return "AWAY";
  return null;
}

export class ApiFootballClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly now: () => Date;

  constructor(options: ClientOptions) {
    if (!options.apiKey.trim()) throw new TypeError("API-FOOTBALL apiKey is required");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://v3.football.api-sports.io").replace(/\/$/, "");
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  private async get<T>(path: string, parameters?: Record<string, string | number>): Promise<SupplierResult<T> & { paging?: { current: number; total: number } }> {
    const url = new URL(`${this.baseUrl}/${path}`);
    for (const [key, value] of Object.entries(parameters ?? {})) url.searchParams.set(key, String(value));
    let response: Response;
    try {
      response = await this.fetcher(url, { method: "GET", headers: { "x-apisports-key": this.apiKey } });
    } catch {
      throw new Error("API-FOOTBALL request failed: network error");
    }
    const quota: QuotaHeaders = {};
    const supplierLimit = asNumber(response.headers.get("x-ratelimit-requests-limit"));
    const supplierRemaining = asNumber(response.headers.get("x-ratelimit-requests-remaining"));
    if (supplierLimit !== undefined) quota.supplierLimit = supplierLimit;
    if (supplierRemaining !== undefined) quota.supplierRemaining = supplierRemaining;
    const payload = await response.json() as { errors?: unknown; response?: T; paging?: { current?: number; total?: number } };
    const hasErrors = Array.isArray(payload.errors) ? payload.errors.length > 0 : Boolean(payload.errors && Object.keys(payload.errors as object).length);
    if (!response.ok || hasErrors || payload.response === undefined) throw new Error(`API-FOOTBALL request failed: HTTP ${response.status}`);
    const paging = payload.paging && Number.isSafeInteger(payload.paging.current) && Number.isSafeInteger(payload.paging.total)
      ? { current: payload.paging.current!, total: payload.paging.total! }
      : undefined;
    return { data: payload.response, quota, ...(paging ? { paging } : {}) };
  }

  async fetchFixtures(input: { leagueId: number; season: number; from: string; to: string }): Promise<SupplierResult<FixtureSnapshot[]>> {
    const result = await this.get<Array<any>>("fixtures", { league: input.leagueId, season: input.season, from: input.from, to: input.to, timezone: "UTC" });
    const capturedAt = this.now().toISOString();
    return {
      quota: result.quota,
      data: result.data.map((item) => {
        const dataAsOf = new Date(item.fixture.date).toISOString();
        const status = statusFrom(item.fixture.status.short);
        const resultConfirmed = status === "FINISHED" || status === "CANCELLED";
        const homeScore = typeof item.goals?.home === "number" ? item.goals.home : null;
        const awayScore = typeof item.goals?.away === "number" ? item.goals.away : null;
        const resultVersion = resultConfirmed ? versionOf({ supplierFixtureId: item.fixture.id, status, homeScore, awayScore }) : null;
        const fixture: Omit<FixtureSnapshot, "version"> = {
          id: `api-football:${item.fixture.id}`,
          supplier: "API_FOOTBALL",
          supplierFixtureId: item.fixture.id,
          competitionId: item.league.id,
          competitionName: item.league.name,
          season: item.league.season,
          kickoffAt: dataAsOf,
          status,
          homeTeam: { supplierTeamId: item.teams.home.id, name: item.teams.home.name },
          awayTeam: { supplierTeamId: item.teams.away.id, name: item.teams.away.name },
          dataAsOf,
          capturedAt,
          result: { confirmed: resultConfirmed, homeScore, awayScore, version: resultVersion },
        };
        return { ...fixture, version: versionOf(fixture) };
      }),
    };
  }

  async fetchPrematchOdds(input: { fixtureId: number; bookmakerId: number }): Promise<SupplierResult<OddsSnapshot | null>> {
    const result = await this.get<Array<any>>("odds", { fixture: input.fixtureId, bookmaker: input.bookmakerId, bet: 1 });
    const item = result.data[0];
    return { data: item ? this.mapPrematchOdds(item, input.bookmakerId) : null, quota: result.quota };
  }

  async fetchPrematchOddsPage(input: { leagueId: number; season: number; date: string; bookmakerId: number; page: number }): Promise<SupplierPageResult<OddsSnapshot[]>> {
    const result = await this.get<Array<any>>("odds", { league: input.leagueId, season: input.season, date: input.date, timezone: "UTC", bookmaker: input.bookmakerId, bet: 1, page: input.page });
    return {
      data: result.data.flatMap((item) => { const snapshot = this.mapPrematchOdds(item, input.bookmakerId); return snapshot ? [snapshot] : []; }),
      quota: result.quota,
      paging: result.paging ?? { current: input.page, total: input.page },
    };
  }

  private mapPrematchOdds(item: any, bookmakerId: number): OddsSnapshot | null {
    const fixtureId = item?.fixture?.id;
    const bookmaker = item?.bookmakers?.find((candidate: any) => candidate.id === bookmakerId);
    const market = bookmaker?.bets?.find((candidate: any) => candidate.id === 1);
    if (!Number.isSafeInteger(fixtureId) || !bookmaker || !market) return null;
    const snapshotWithoutVersion: Omit<OddsSnapshot, "version"> = {
      productMarketId: `api-football:${fixtureId}:bookmaker:${bookmaker.id}:market:${market.id}`,
      fixtureId: `api-football:${fixtureId}`,
      supplier: "API_FOOTBALL",
      supplierFixtureId: fixtureId,
      bookmakerId: bookmaker.id,
      bookmakerName: bookmaker.name,
      marketId: market.id,
      marketName: market.name,
      dataAsOf: new Date(item.update).toISOString(),
      capturedAt: this.now().toISOString(),
      outcomes: market.values.flatMap((value: any) => {
        const selection = selectionFrom(value.value);
        return selection ? [{ selection, supplierLabel: value.value, decimalOdds: String(value.odd) }] : [];
      }),
    };
    return { ...snapshotWithoutVersion, version: versionOf(snapshotWithoutVersion) };
  }

  async fetchLive(input: { fixtureId: number; bookmakerId: number }): Promise<SupplierResult<LiveSnapshot | null>> {
    const result = await this.get<Array<any>>("odds/live", { fixture: input.fixtureId });
    const item = result.data[0];
    if (!item) return { data: null, quota: result.quota };
    const capturedAt = this.now().toISOString();
    return {
      data: {
        fixtureId: `api-football:${input.fixtureId}`,
        supplierFixtureId: input.fixtureId,
        homeScore: item.teams?.home?.goals ?? 0,
        awayScore: item.teams?.away?.goals ?? 0,
        minute: item.fixture?.status?.elapsed ?? null,
        dataAsOf: item.update ? new Date(item.update).toISOString() : capturedAt,
        capturedAt,
        markets: (item.bets ?? []).map((bet: any) => ({
          supplierMarketId: bet.id,
          name: bet.name,
          values: (bet.values ?? []).map((value: any) => ({ value: String(value.value), decimalOdds: String(value.odd), suspended: Boolean(value.suspended) })),
        })),
      },
      quota: result.quota,
    };
  }

  async fetchStatus(): Promise<{ supplierCurrent: number; supplierLimit: number }> {
    const result = await this.get<any>("status");
    return { supplierCurrent: result.data.requests.current, supplierLimit: result.data.requests.limit_day };
  }
}
