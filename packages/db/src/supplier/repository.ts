import { createHash } from "node:crypto";
import type postgres from "postgres";

export type SyncState = "IDLE" | "SYNCING" | "PAUSED" | "FAILED";
export type MatchStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";
export type Selection = "HOME" | "DRAW" | "AWAY";

export interface FixtureSnapshotRecord {
  id: string;
  supplier: "API_FOOTBALL" | "OPENLIGADB";
  supplierFixtureId: number;
  competitionId: number;
  competitionName: string;
  season: number;
  kickoffAt: string;
  status: MatchStatus;
  homeTeam: { supplierTeamId: number; name: string };
  awayTeam: { supplierTeamId: number; name: string };
  version: string;
  dataAsOf: string;
  capturedAt: string;
  oddsDataAsOf?: string;
  result?: { confirmed: boolean; homeScore: number | null; awayScore: number | null; version: string | null };
}

export interface OddsSnapshotRecord {
  fixtureId: string;
  supplier: "API_FOOTBALL" | "THE_ODDS_API" | "PLATFORM";
  supplierFixtureId: number;
  bookmakerId: number;
  bookmakerName: string;
  marketId: number;
  marketName: string;
  version: string;
  dataAsOf: string;
  capturedAt: string;
  outcomes: Array<{ selection: Selection; supplierLabel: string; decimalOdds: string }>;
}

export interface LiveSnapshotRecord {
  fixtureId: string;
  supplierFixtureId: number;
  homeScore: number;
  awayScore: number;
  minute: number | null;
  dataAsOf: string;
  capturedAt: string;
  markets: Array<{ supplierMarketId: number; name: string; values: Array<{ value: string; decimalOdds: string; suspended: boolean }> }>;
}

export function marketCacheId(fixtureId: string, bookmakerId: number, supplierMarketId: number): string {
  return `${fixtureId}:bookmaker:${bookmakerId}:market:${supplierMarketId}`;
}

export function cacheEtag(value: unknown): string {
  return `"${createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`;
}

export function statusForSync(_syncState: SyncState, sourceVerified: boolean, dataAsOf: Date, now: Date, _supplier?: OddsSnapshotRecord["supplier"]): "OPEN" | "DATA_UNAVAILABLE" {
  const age = now.getTime() - dataAsOf.getTime();
  return sourceVerified && Number.isFinite(age) && age >= 0 ? "OPEN" : "DATA_UNAVAILABLE";
}

type FixtureRow = {
  id: string; supplier: "API_FOOTBALL" | "OPENLIGADB"; supplierFixtureId: string; competitionId: string; competitionName: string;
  season: number; kickoffAt: Date | string; status: MatchStatus; homeTeamId: string; homeTeamName: string; awayTeamId: string;
  awayTeamName: string; currentVersion: string; dataAsOf: Date | string; capturedAt: Date | string; oddsDataAsOf?: Date | string | null;
  resultConfirmed?: boolean; homeScore?: number | null; awayScore?: number | null; resultVersion?: string | null;
};

type OddsRow = {
  productMarketId: string; fixtureId: string; supplier: "API_FOOTBALL" | "THE_ODDS_API" | "PLATFORM"; supplierFixtureId: string; bookmakerId: string;
  bookmakerName: string; supplierMarketId: string; marketName: string; currentVersion: string; dataAsOf: Date | string;
  capturedAt: Date | string; outcomes: unknown;
};

type LiveRow = {
  fixtureId: string; supplierFixtureId: string; homeScore: number; awayScore: number; minute: number | null;
  dataAsOf: Date | string; capturedAt: Date | string; markets: LiveSnapshotRecord["markets"];
};

function isoTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid PostgreSQL timestamp");
  return date.toISOString();
}

function mapFixture(row: FixtureRow): FixtureSnapshotRecord {
  return {
    id: row.id,
    supplier: row.supplier,
    supplierFixtureId: Number(row.supplierFixtureId),
    competitionId: Number(row.competitionId),
    competitionName: row.competitionName,
    season: row.season,
    kickoffAt: isoTimestamp(row.kickoffAt),
    status: row.status,
    homeTeam: { supplierTeamId: Number(row.homeTeamId), name: row.homeTeamName },
    awayTeam: { supplierTeamId: Number(row.awayTeamId), name: row.awayTeamName },
    version: row.currentVersion,
    dataAsOf: isoTimestamp(row.dataAsOf),
    capturedAt: isoTimestamp(row.capturedAt),
    ...(row.oddsDataAsOf ? { oddsDataAsOf: isoTimestamp(row.oddsDataAsOf) } : {}),
    ...(typeof row.resultConfirmed === "boolean" ? { result: {
      confirmed: row.resultConfirmed,
      homeScore: row.homeScore ?? null,
      awayScore: row.awayScore ?? null,
      version: row.resultVersion ?? null,
    } } : {}),
  };
}

function mapOdds(row: OddsRow): OddsSnapshotRecord & { productMarketId: string } {
  return {
    productMarketId: row.productMarketId,
    fixtureId: row.fixtureId,
    supplier: row.supplier,
    supplierFixtureId: Number(row.supplierFixtureId),
    bookmakerId: Number(row.bookmakerId),
    bookmakerName: row.bookmakerName,
    marketId: Number(row.supplierMarketId),
    marketName: row.marketName,
    version: row.currentVersion,
    dataAsOf: isoTimestamp(row.dataAsOf),
    capturedAt: isoTimestamp(row.capturedAt),
    outcomes: parseOutcomes(row.outcomes),
  };
}

function parseOutcomes(value: unknown): OddsSnapshotRecord["outcomes"] {
  let candidate = value;
  if (typeof candidate === "string") {
    try { candidate = JSON.parse(candidate); }
    catch { return []; }
  }
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const outcome = item as { selection?: unknown; supplierLabel?: unknown; decimalOdds?: unknown };
    if (!["HOME", "DRAW", "AWAY"].includes(String(outcome.selection)) || typeof outcome.decimalOdds !== "string") return [];
    return [{ selection: outcome.selection as Selection, supplierLabel: typeof outcome.supplierLabel === "string" ? outcome.supplierLabel : String(outcome.selection), decimalOdds: outcome.decimalOdds }];
  });
}

export class PostgresMatchSnapshotRepository {
  constructor(private readonly sql: postgres.Sql, private readonly clock: { now(): Date } = { now: () => new Date() }) {}

  async saveFixtures(fixtures: FixtureSnapshotRecord[]): Promise<void> {
    await this.sql.begin(async (tx) => {
      for (const fixture of fixtures) {
        const etag = cacheEtag(fixture);
        await tx`INSERT INTO supplier.fixtures
          (id,supplier,supplier_fixture_id,competition_id,competition_name,season,kickoff_at,status,home_team_id,home_team_name,away_team_id,away_team_name,current_version,data_as_of,captured_at,etag,updated_at,result_confirmed,home_score,away_score,result_version)
          VALUES (${fixture.id},${fixture.supplier},${fixture.supplierFixtureId},${fixture.competitionId},${fixture.competitionName},${fixture.season},${fixture.kickoffAt},${fixture.status},${fixture.homeTeam.supplierTeamId},${fixture.homeTeam.name},${fixture.awayTeam.supplierTeamId},${fixture.awayTeam.name},${fixture.version},${fixture.dataAsOf},${fixture.capturedAt},${etag},${this.clock.now()},${fixture.result?.confirmed ?? false},${fixture.result?.homeScore ?? null},${fixture.result?.awayScore ?? null},${fixture.result?.version ?? null})
          ON CONFLICT (id) DO UPDATE SET supplier=EXCLUDED.supplier,supplier_fixture_id=EXCLUDED.supplier_fixture_id,
            competition_id=EXCLUDED.competition_id,competition_name=EXCLUDED.competition_name,season=EXCLUDED.season,
            kickoff_at=EXCLUDED.kickoff_at,status=EXCLUDED.status,home_team_id=EXCLUDED.home_team_id,home_team_name=EXCLUDED.home_team_name,
            away_team_id=EXCLUDED.away_team_id,away_team_name=EXCLUDED.away_team_name,current_version=EXCLUDED.current_version,
            data_as_of=EXCLUDED.data_as_of,captured_at=EXCLUDED.captured_at,etag=EXCLUDED.etag,updated_at=EXCLUDED.updated_at,
            result_confirmed=EXCLUDED.result_confirmed,home_score=EXCLUDED.home_score,away_score=EXCLUDED.away_score,result_version=EXCLUDED.result_version
          WHERE EXCLUDED.captured_at >= supplier.fixtures.captured_at`;
        await tx`INSERT INTO supplier.fixture_snapshots (fixture_id,version,data_as_of,captured_at,etag,payload)
          VALUES (${fixture.id},${fixture.version},${fixture.dataAsOf},${fixture.capturedAt},${etag},CAST(${JSON.stringify(fixture)} AS jsonb))
          ON CONFLICT (fixture_id,version) DO NOTHING`;
      }
    });
  }

  async saveOdds(odds: OddsSnapshotRecord): Promise<void> {
    const productMarketId = marketCacheId(odds.fixtureId, odds.bookmakerId, odds.marketId);
    const etag = cacheEtag({ productMarketId, ...odds });
    const now = this.clock.now();
    const status = statusForSync("IDLE", true, new Date(odds.dataAsOf), now, odds.supplier);
    await this.sql.begin(async (tx) => {
      await tx`INSERT INTO supplier.markets
        (id,fixture_id,status,sync_state,supplier,supplier_fixture_id,bookmaker_id,bookmaker_name,supplier_market_id,market_name,current_version,data_as_of,captured_at,outcomes,source_verified,etag,updated_at)
        VALUES (${productMarketId},${odds.fixtureId},${status},'IDLE',${odds.supplier},${odds.supplierFixtureId},${odds.bookmakerId},${odds.bookmakerName},${odds.marketId},${odds.marketName},${odds.version},${odds.dataAsOf},${odds.capturedAt},CAST(${JSON.stringify(odds.outcomes)} AS jsonb),true,${etag},${now})
        ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,sync_state='IDLE',current_version=EXCLUDED.current_version,
          data_as_of=EXCLUDED.data_as_of,captured_at=EXCLUDED.captured_at,outcomes=EXCLUDED.outcomes,source_verified=true,
          etag=EXCLUDED.etag,updated_at=EXCLUDED.updated_at
        WHERE EXCLUDED.captured_at >= supplier.markets.captured_at`;
      await tx`INSERT INTO supplier.odds_snapshots
        (market_id,version,supplier,supplier_fixture_id,bookmaker_id,bookmaker_name,supplier_market_id,market_name,data_as_of,captured_at,outcomes,source_verified,etag)
        VALUES (${productMarketId},${odds.version},${odds.supplier},${odds.supplierFixtureId},${odds.bookmakerId},${odds.bookmakerName},${odds.marketId},${odds.marketName},${odds.dataAsOf},${odds.capturedAt},CAST(${JSON.stringify(odds.outcomes)} AS jsonb),true,${etag})
        ON CONFLICT (market_id,version) DO NOTHING`;
    });
  }

  async saveLive(live: LiveSnapshotRecord): Promise<void> {
    const etag = cacheEtag(live);
    await this.sql`INSERT INTO supplier.live_snapshots
      (fixture_id,supplier_fixture_id,home_score,away_score,minute,data_as_of,captured_at,markets,etag,updated_at)
      VALUES (${live.fixtureId},${live.supplierFixtureId},${live.homeScore},${live.awayScore},${live.minute},${live.dataAsOf},${live.capturedAt},CAST(${JSON.stringify(live.markets)} AS jsonb),${etag},${this.clock.now()})
      ON CONFLICT (fixture_id) DO UPDATE SET supplier_fixture_id=EXCLUDED.supplier_fixture_id,home_score=EXCLUDED.home_score,
        away_score=EXCLUDED.away_score,minute=EXCLUDED.minute,data_as_of=EXCLUDED.data_as_of,captured_at=EXCLUDED.captured_at,
        markets=EXCLUDED.markets,etag=EXCLUDED.etag,updated_at=EXCLUDED.updated_at
      WHERE EXCLUDED.captured_at >= supplier.live_snapshots.captured_at`;
  }

  async getFixture(matchId: string): Promise<FixtureSnapshotRecord | null> {
    const [row] = await this.sql<FixtureRow[]>`SELECT id,supplier,supplier_fixture_id AS "supplierFixtureId",competition_id AS "competitionId",
      competition_name AS "competitionName",season,kickoff_at AS "kickoffAt",status,home_team_id AS "homeTeamId",home_team_name AS "homeTeamName",
      away_team_id AS "awayTeamId",away_team_name AS "awayTeamName",current_version AS "currentVersion",data_as_of AS "dataAsOf",captured_at AS "capturedAt",
      result_confirmed AS "resultConfirmed",home_score AS "homeScore",away_score AS "awayScore",result_version AS "resultVersion"
      FROM supplier.fixtures WHERE id=${matchId} LIMIT 1`;
    return row ? mapFixture(row) : null;
  }

  async listFixtures(): Promise<FixtureSnapshotRecord[]> {
    const rows = await this.sql<FixtureRow[]>`SELECT id,supplier,supplier_fixture_id AS "supplierFixtureId",competition_id AS "competitionId",
      competition_name AS "competitionName",season,kickoff_at AS "kickoffAt",status,home_team_id AS "homeTeamId",home_team_name AS "homeTeamName",
      away_team_id AS "awayTeamId",away_team_name AS "awayTeamName",current_version AS "currentVersion",data_as_of AS "dataAsOf",captured_at AS "capturedAt",
      result_confirmed AS "resultConfirmed",home_score AS "homeScore",away_score AS "awayScore",result_version AS "resultVersion",latest_market."oddsDataAsOf"
      FROM supplier.fixtures
      LEFT JOIN LATERAL (SELECT data_as_of AS "oddsDataAsOf" FROM supplier.markets WHERE fixture_id=supplier.fixtures.id ORDER BY data_as_of DESC LIMIT 1) latest_market ON true
      ORDER BY kickoff_at,id`;
    return rows.map(mapFixture);
  }

  async getOdds(matchId: string): Promise<(OddsSnapshotRecord & { productMarketId: string }) | null> {
    const [row] = await this.sql<OddsRow[]>`SELECT id AS "productMarketId",fixture_id AS "fixtureId",supplier,supplier_fixture_id AS "supplierFixtureId",
      bookmaker_id AS "bookmakerId",bookmaker_name AS "bookmakerName",supplier_market_id AS "supplierMarketId",market_name AS "marketName",
      current_version AS "currentVersion",data_as_of AS "dataAsOf",captured_at AS "capturedAt",outcomes
      FROM supplier.markets WHERE fixture_id=${matchId} ORDER BY captured_at DESC LIMIT 1`;
    return row ? mapOdds(row) : null;
  }

  async getLive(matchId: string): Promise<LiveSnapshotRecord | null> {
    const [row] = await this.sql<LiveRow[]>`SELECT fixture_id AS "fixtureId",supplier_fixture_id AS "supplierFixtureId",home_score AS "homeScore",
      away_score AS "awayScore",minute,data_as_of AS "dataAsOf",captured_at AS "capturedAt",markets
      FROM supplier.live_snapshots WHERE fixture_id=${matchId} LIMIT 1`;
    return row ? { ...row, supplierFixtureId: Number(row.supplierFixtureId), dataAsOf: isoTimestamp(row.dataAsOf), capturedAt: isoTimestamp(row.capturedAt) } : null;
  }

  async setSyncState(matchId: string, state: SyncState): Promise<void> {
    const now = this.clock.now();
    await this.sql`UPDATE supplier.markets SET sync_state=${state}, status=CASE
      WHEN source_verified=true AND data_as_of <= ${now} THEN 'OPEN'
      ELSE 'DATA_UNAVAILABLE' END, updated_at=${now} WHERE fixture_id=${matchId}`;
  }

  async getSyncState(matchId: string): Promise<SyncState> {
    const [row] = await this.sql<Array<{ syncState: SyncState }>>`SELECT sync_state AS "syncState" FROM supplier.markets
      WHERE fixture_id=${matchId} ORDER BY updated_at DESC LIMIT 1`;
    return row?.syncState ?? "IDLE";
  }

  async claimExternalSync(key: string, at: Date, minimumIntervalMs: number): Promise<boolean> {
    const cutoff = new Date(at.getTime() - minimumIntervalMs);
    const rows = await this.sql<Array<{ claimed: boolean }>>`INSERT INTO supplier.external_sync_claims (sync_key,last_attempt_at,updated_at)
      VALUES (${key},${at},${at})
      ON CONFLICT (sync_key) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at,updated_at=EXCLUDED.updated_at
      WHERE supplier.external_sync_claims.last_attempt_at <= ${cutoff}
      RETURNING true AS claimed`;
    return rows.length === 1 && rows[0]?.claimed === true;
  }

  async getCacheMetadata(matchId: string): Promise<{ fixtureEtag: string; marketEtag: string | null; liveEtag: string | null } | null> {
    const [row] = await this.sql<Array<{ fixtureEtag: string; marketEtag: string | null; liveEtag: string | null }>>`
      SELECT f.etag AS "fixtureEtag",m.etag AS "marketEtag",l.etag AS "liveEtag" FROM supplier.fixtures f
      LEFT JOIN LATERAL (SELECT etag FROM supplier.markets WHERE fixture_id=f.id ORDER BY captured_at DESC LIMIT 1) m ON true
      LEFT JOIN supplier.live_snapshots l ON l.fixture_id=f.id WHERE f.id=${matchId} LIMIT 1`;
    return row ?? null;
  }
}
