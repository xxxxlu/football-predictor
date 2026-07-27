import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  ERGAST_SOURCE_BY_KIND,
  mapErgastQualifyingClassification,
  mapErgastRaceClassification,
  planSessionImport,
  type ErgastResultRow,
  type F1SessionKind,
  type F1SessionState,
} from "@pulse/domain";

type Endpoint = "results" | "qualifying" | "sprint";
type SessionRow = {
  id: string;
  kind: F1SessionKind;
  startsAt: Date | string;
  state: F1SessionState;
  resultVersion: number | null;
  round: number;
};
type RaceRecord = Record<string, unknown>;

export type F1ResultsSyncSummary = {
  imported: number;
  unchanged: number;
  noSource: number;
  notStarted: number;
  cancelled: number;
  invalid: number;
  standingsUpdated: number;
};

export type F1ResultsSyncOptions = {
  season: number;
  baseUrl?: string;
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
};

/**
 * Polls the maintained Ergast-compatible Jolpica API and atomically publishes only
 * complete classifications. It deliberately never invents an in-progress result:
 * markets are locked at lights-out by F1SessionLockService, then this service turns
 * them FINISHED once the upstream result is available and confirmed in our DB.
 */
export class JolpicaF1ResultsSync {
  private readonly baseUrl: string;
  private readonly now: () => Date;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(private readonly sql: postgres.Sql, private readonly options: F1ResultsSyncOptions) {
    this.baseUrl = (options.baseUrl?.trim() || "https://api.jolpi.ca/ergast").replace(/\/$/, "");
    this.now = options.now ?? (() => new Date());
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async sync(): Promise<F1ResultsSyncSummary> {
    const [resultsByRound, qualifyingByRound, sprintByRound, standings] = await Promise.all([
      this.fetchSeasonRounds("results"),
      this.fetchSeasonRounds("qualifying"),
      this.fetchSeasonRounds("sprint"),
      this.fetchDriverStandings(),
    ]);
    const sourceByEndpoint: Record<Endpoint, Map<number, ErgastResultRow[]>> = {
      results: resultsByRound,
      qualifying: qualifyingByRound,
      sprint: sprintByRound,
    };
    const summary: F1ResultsSyncSummary = { imported: 0, unchanged: 0, noSource: 0, notStarted: 0, cancelled: 0, invalid: 0, standingsUpdated: 0 };
    const [systemUser] = await this.sql<Array<{ id: string }>>`SELECT id FROM identity.users WHERE is_super_admin=true ORDER BY created_at LIMIT 1`;
    if (!systemUser) throw new Error("No super admin user found to attribute F1 sync results");
    const drivers = await this.sql<Array<{ code: string }>>`SELECT code FROM f1.drivers WHERE active=true`;
    const knownCodes = new Set(drivers.map((row) => row.code));
    const sessions = await this.sql<SessionRow[]>`SELECT s.id,s.kind,s.starts_at AS "startsAt",s.state,s.result_version AS "resultVersion",w.round
      FROM f1.sessions s JOIN f1.race_weekends w ON w.id=s.weekend_id
      WHERE w.season=${this.options.season} ORDER BY w.round,s.starts_at`;

    for (const session of sessions) {
      const endpoint = ERGAST_SOURCE_BY_KIND[session.kind];
      const sourceRows = endpoint ? sourceByEndpoint[endpoint].get(session.round) ?? [] : [];
      const mapped = sourceRows.length === 0
        ? null
        : endpoint === "qualifying"
          ? mapErgastQualifyingClassification(sourceRows, knownCodes)
          : mapErgastRaceClassification(sourceRows, knownCodes);
      const sourceClassification = mapped?.classification ?? null;
      const [existing] = await this.sql<Array<{ classification: unknown }>>`SELECT r.classification
        FROM f1.session_results r JOIN f1.sessions s ON s.id=r.session_id AND s.result_version=r.version
        WHERE r.session_id=${session.id} AND r.confirmed_at IS NOT NULL LIMIT 1`;
      const plan = planSessionImport({
        session: { kind: session.kind, startsAt: new Date(session.startsAt).toISOString(), state: session.state },
        now: this.now(),
        sourceClassification,
        existingConfirmed: existing ? asClassification(existing.classification) : null,
      });
      if (plan.action === "NOT_STARTED") { summary.notStarted += 1; continue; }
      if (plan.action === "CANCELLED") { summary.cancelled += 1; continue; }
      if (plan.action === "NO_SOURCE_DATA") { summary.noSource += 1; continue; }
      if (plan.action === "INVALID") { summary.invalid += 1; continue; }
      if (plan.action === "SKIP_UNCHANGED") { summary.unchanged += 1; continue; }

      await this.sql.begin(async (tx) => {
        const [locked] = await tx<Array<{ id: string }>>`SELECT id FROM f1.sessions WHERE id=${session.id} FOR UPDATE`;
        if (!locked) return;
        const [latest] = await tx<Array<{ latest: number | string | null }>>`SELECT GREATEST(
          COALESCE((SELECT MAX(version) FROM f1.session_results WHERE session_id=${session.id}), 0),
          COALESCE((SELECT result_version FROM f1.sessions WHERE id=${session.id}), 0)) AS latest`;
        const version = Number(latest?.latest ?? 0) + 1;
        const occurredAt = this.now().toISOString();
        await tx`INSERT INTO f1.session_results (session_id,version,classification,entered_by,entered_at,confirmed_at)
          VALUES (${session.id},${version},${JSON.stringify(plan.classification)}::text::jsonb,${systemUser.id},${occurredAt},${occurredAt})`;
        await tx`UPDATE f1.sessions SET result_version=${version},result_confirmed=true,state='FINISHED',updated_at=${occurredAt} WHERE id=${session.id}`;
        await tx`UPDATE f1.markets SET status='CLOSED',updated_at=${occurredAt} WHERE session_id=${session.id} AND status='OPEN'`;
        const metadata = JSON.stringify({ source: `jolpica:${this.baseUrl}`, endpoint: `${this.options.season}/${endpoint}`, round: session.round, kind: session.kind, version });
        for (const action of ["F1_RESULT_ENTERED", "F1_RESULT_CONFIRMED"] as const) {
          await tx`INSERT INTO ops.audit_events (id,actor_user_id,action,target_type,target_id,result,metadata,occurred_at)
            VALUES (${randomUUID()},${systemUser.id},${action},'F1_SESSION',${session.id},'OK',${metadata}::text::jsonb,${occurredAt})`;
        }
      });
      summary.imported += 1;
    }

    for (const [code, points] of standings) {
      if (!knownCodes.has(code)) continue;
      const updated = await this.sql`UPDATE f1.drivers SET season_points=${points},updated_at=now() WHERE code=${code} AND season_points<>${points}`;
      if (updated.count > 0) summary.standingsUpdated += 1;
    }
    return summary;
  }

  private async fetchSeasonRounds(endpoint: Endpoint): Promise<Map<number, ErgastResultRow[]>> {
    const key: Record<Endpoint, string> = { results: "Results", qualifying: "QualifyingResults", sprint: "SprintResults" };
    const byRound = new Map<number, ErgastResultRow[]>();
    let offset = 0;
    const limit = 100;
    for (;;) {
      const payload = await this.fetchJson(`${this.baseUrl}/f1/${this.options.season}/${endpoint}.json?limit=${limit}&offset=${offset}`);
      const data = recordAt(payload, "MRData");
      const raceTable = recordAt(data, "RaceTable");
      const races = Array.isArray(raceTable?.Races) ? raceTable.Races : [];
      for (const race of races) {
        if (!isRecord(race)) continue;
        const round = Number.parseInt(String(race.round ?? ""), 10);
        const rawRows = race[key[endpoint]];
        const rows: unknown[] = Array.isArray(rawRows) ? rawRows : [];
        if (!Number.isInteger(round) || rows.length === 0) continue;
        byRound.set(round, [...(byRound.get(round) ?? []), ...(rows as ErgastResultRow[])]);
      }
      const total = Number.parseInt(String(data?.total ?? "0"), 10);
      offset += limit;
      if (!Number.isFinite(total) || offset >= total) break;
    }
    return byRound;
  }

  private async fetchDriverStandings(): Promise<Map<string, number>> {
    const payload = await this.fetchJson(`${this.baseUrl}/f1/${this.options.season}/driverstandings.json?limit=100`);
    const data = recordAt(payload, "MRData");
    const standingsTable = recordAt(data, "StandingsTable");
    const lists = Array.isArray(standingsTable?.StandingsLists) ? standingsTable.StandingsLists : [];
    const first = isRecord(lists[0]) ? lists[0] : null;
    const entries = Array.isArray(first?.DriverStandings) ? first.DriverStandings : [];
    const points = new Map<string, number>();
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const driver = recordAt(entry, "Driver");
      const code = driver?.code;
      const value = Number(entry.points);
      if (typeof code === "string" && Number.isFinite(value)) points.set(code, value);
    }
    return points;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const response = await this.fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Jolpica request failed: HTTP ${response.status}`);
    return response.json();
  }
}

export function createJolpicaF1ResultsSync(databaseUrl: string, options: F1ResultsSyncOptions) {
  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  return { sync: () => new JolpicaF1ResultsSync(sql, options).sync(), close: () => sql.end() };
}

function isRecord(value: unknown): value is RaceRecord { return typeof value === "object" && value !== null; }
function recordAt(value: unknown, key: string): RaceRecord | null { return isRecord(value) && isRecord(value[key]) ? value[key] : null; }
function asClassification(value: unknown) { const decoded = typeof value === "string" ? JSON.parse(value) : value; return Array.isArray(decoded) ? decoded as ReturnType<typeof mapErgastRaceClassification>["classification"] : null; }
