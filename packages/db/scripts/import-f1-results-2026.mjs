/** Imports official 2026 F1 session results from Jolpica (the maintained
 *  Ergast-successor API, https://api.jolpi.ca) into f1.session_results, and
 *  refreshes driver season points from the same source's driver standings.
 *
 *  Idempotent — safe to re-run: an unchanged source classification is a no-op;
 *  a changed one appends a new confirmed result version (the settlement worker
 *  then re-settles any affected tickets, same as an admin correction).
 *  Sessions that have not started are never touched; SPRINT_QUALIFYING has no
 *  Ergast-compatible endpoint, so those sessions are reported as uncovered
 *  instead of being given a fabricated classification.
 *
 *  Requires the domain package to be built (mapping/validation is imported).
 *  Env: DATABASE_URL (required), JOLPICA_BASE_URL (default https://api.jolpi.ca/ergast),
 *       F1_IMPORT_SEASON (default 2026), DRY_RUN=1 to plan without writing. */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  ERGAST_SOURCE_BY_KIND,
  mapErgastQualifyingClassification,
  mapErgastRaceClassification,
  planSessionImport,
} from "@football-predictor/domain";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const baseUrl = (process.env.JOLPICA_BASE_URL?.trim() || "https://api.jolpi.ca/ergast").replace(/\/$/, "");
const season = Number.parseInt(process.env.F1_IMPORT_SEASON ?? "2026", 10);
const dryRun = process.env.DRY_RUN === "1";

const PAGE_LIMIT = 100;
const RESULT_KEYS = { results: "Results", qualifying: "QualifyingResults", sprint: "SprintResults" };

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Jolpica request failed: HTTP ${response.status} for ${url}`);
  return response.json();
}

/** Fetches a season-wide endpoint with offset pagination and groups rows by round. */
async function fetchSeasonRounds(endpoint) {
  const key = RESULT_KEYS[endpoint];
  const byRound = new Map();
  let offset = 0;
  for (;;) {
    const url = `${baseUrl}/f1/${season}/${endpoint}.json?limit=${PAGE_LIMIT}&offset=${offset}`;
    const payload = await fetchJson(url);
    const table = payload?.MRData?.RaceTable;
    const races = Array.isArray(table?.Races) ? table.Races : [];
    for (const race of races) {
      const round = Number.parseInt(race.round, 10);
      if (!Number.isInteger(round)) continue;
      const rows = Array.isArray(race[key]) ? race[key] : [];
      byRound.set(round, [...(byRound.get(round) ?? []), ...rows]);
    }
    const total = Number.parseInt(payload?.MRData?.total ?? "0", 10);
    offset += PAGE_LIMIT;
    if (!Number.isFinite(total) || offset >= total) break;
  }
  return byRound;
}

async function fetchDriverStandings() {
  const payload = await fetchJson(`${baseUrl}/f1/${season}/driverstandings.json?limit=${PAGE_LIMIT}`);
  const lists = payload?.MRData?.StandingsTable?.StandingsLists;
  const standings = Array.isArray(lists) && lists[0] && Array.isArray(lists[0].DriverStandings) ? lists[0].DriverStandings : [];
  const points = new Map();
  for (const entry of standings) {
    const code = entry?.Driver?.code;
    const value = Number(entry?.points);
    if (typeof code === "string" && Number.isFinite(value)) points.set(code, value);
  }
  return points;
}

const sourceLabel = `jolpica:${baseUrl}`;
console.log(`[import-f1-results] season=${season} source=${baseUrl} dryRun=${dryRun}`);

const [resultsByRound, qualifyingByRound, sprintByRound, standings] = await Promise.all([
  fetchSeasonRounds("results"),
  fetchSeasonRounds("qualifying"),
  fetchSeasonRounds("sprint"),
  fetchDriverStandings(),
]);
console.log(`[import-f1-results] source rounds: results=${resultsByRound.size} qualifying=${qualifyingByRound.size} sprint=${sprintByRound.size} standings=${standings.size} drivers`);

const SOURCE_BY_ENDPOINT = { results: resultsByRound, qualifying: qualifyingByRound, sprint: sprintByRound };

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const summary = { imported: 0, unchanged: 0, noSource: 0, notStarted: 0, cancelled: 0, invalid: 0, standingsUpdated: 0 };
const importedDetails = [];
try {
  const [systemUser] = await sql`SELECT id FROM identity.users WHERE is_super_admin = true ORDER BY created_at LIMIT 1`;
  if (!systemUser) throw new Error("No super admin user found to attribute imported results to");

  const drivers = await sql`SELECT code FROM f1.drivers WHERE active = true`;
  const knownCodes = new Set(drivers.map((row) => row.code));

  const sessions = await sql`SELECT s.id, s.kind, s.starts_at AS "startsAt", s.state, s.result_version AS "resultVersion",
      w.round, w.name AS "weekendName"
    FROM f1.sessions s JOIN f1.race_weekends w ON w.id = s.weekend_id
    WHERE w.season = ${season}
    ORDER BY w.round, s.starts_at`;

  const now = new Date();
  for (const session of sessions) {
    const endpoint = ERGAST_SOURCE_BY_KIND[session.kind];
    const rows = endpoint ? SOURCE_BY_ENDPOINT[endpoint].get(session.round) ?? null : null;
    let sourceClassification = null;
    let issues = [];
    if (rows && rows.length > 0) {
      const mapped = endpoint === "qualifying"
        ? mapErgastQualifyingClassification(rows, knownCodes)
        : mapErgastRaceClassification(rows, knownCodes);
      sourceClassification = mapped.classification;
      issues = mapped.issues;
    }
    if (issues.length > 0) {
      console.warn(`[import-f1-results] R${session.round} ${session.kind}: skipped ${issues.length} source rows: ${issues.map((issue) => `${issue.driverRef}(${issue.reason})`).join(", ")}`);
    }

    const [existing] = await sql`SELECT r.version, r.classification FROM f1.session_results r
      JOIN f1.sessions s ON s.id = r.session_id AND s.result_version = r.version
      WHERE r.session_id = ${session.id} AND r.confirmed_at IS NOT NULL LIMIT 1`;
    const existingConfirmed = existing
      ? (typeof existing.classification === "string" ? JSON.parse(existing.classification) : existing.classification)
      : null;

    const plan = planSessionImport({
      session: { kind: session.kind, startsAt: new Date(session.startsAt).toISOString(), state: session.state },
      now,
      sourceClassification,
      existingConfirmed,
    });

    if (plan.action === "NOT_STARTED") { summary.notStarted += 1; continue; }
    if (plan.action === "CANCELLED") { summary.cancelled += 1; continue; }
    if (plan.action === "NO_SOURCE_DATA") {
      summary.noSource += 1;
      if (session.kind !== "SPRINT_QUALIFYING") {
        console.warn(`[import-f1-results] R${session.round} ${session.kind}: past session but source has no classification yet`);
      }
      continue;
    }
    if (plan.action === "INVALID") {
      summary.invalid += 1;
      console.error(`[import-f1-results] R${session.round} ${session.kind}: source classification invalid (${plan.reason}) — not imported`);
      continue;
    }
    if (plan.action === "SKIP_UNCHANGED") { summary.unchanged += 1; continue; }

    summary.imported += 1;
    importedDetails.push(`R${session.round} ${session.weekendName} ${session.kind}`);
    if (dryRun) continue;

    await sql.begin(async (tx) => {
      await tx`SELECT id FROM f1.sessions WHERE id = ${session.id} FOR UPDATE`;
      const [latest] = await tx`SELECT GREATEST(
        COALESCE((SELECT MAX(version) FROM f1.session_results WHERE session_id = ${session.id}), 0),
        COALESCE((SELECT result_version FROM f1.sessions WHERE id = ${session.id}), 0)) AS latest`;
      const version = Number(latest?.latest ?? 0) + 1;
      const occurredAt = new Date();
      await tx`INSERT INTO f1.session_results (session_id, version, classification, entered_by, entered_at, confirmed_at)
        VALUES (${session.id}, ${version}, ${JSON.stringify(plan.classification)}::text::jsonb, ${systemUser.id}, ${occurredAt.toISOString()}, ${occurredAt.toISOString()})`;
      await tx`UPDATE f1.sessions SET result_version = ${version}, result_confirmed = true, state = 'FINISHED', updated_at = ${occurredAt.toISOString()}
        WHERE id = ${session.id}`;
      await tx`UPDATE f1.markets SET status = 'CLOSED', updated_at = ${occurredAt.toISOString()} WHERE session_id = ${session.id} AND status = 'OPEN'`;
      const metadata = { source: sourceLabel, endpoint: `${season}/${endpoint}`, round: session.round, kind: session.kind, version };
      for (const action of ["F1_RESULT_ENTERED", "F1_RESULT_CONFIRMED"]) {
        await tx`INSERT INTO ops.audit_events (id, actor_user_id, action, target_type, target_id, result, metadata, occurred_at)
          VALUES (${randomUUID()}, ${systemUser.id}, ${action}, 'F1_SESSION', ${session.id}, 'OK', ${JSON.stringify(metadata)}::text::jsonb, ${occurredAt.toISOString()})`;
      }
    });
  }

  // Season points from the same source's driver standings — replaces the
  // hardcoded seed snapshot with a traceable value.
  for (const [code, points] of standings) {
    if (!knownCodes.has(code)) {
      console.warn(`[import-f1-results] standings code ${code} not in entry list — skipped`);
      continue;
    }
    if (dryRun) { summary.standingsUpdated += 1; continue; }
    const updated = await sql`UPDATE f1.drivers SET season_points = ${points}, updated_at = now()
      WHERE code = ${code} AND season_points <> ${points}`;
    if (updated.count > 0) summary.standingsUpdated += 1;
  }
} finally {
  await sql.end();
}

console.log(`[import-f1-results] done: imported=${summary.imported} unchanged=${summary.unchanged} noSource=${summary.noSource} notStarted=${summary.notStarted} cancelled=${summary.cancelled} invalid=${summary.invalid} standingsUpdated=${summary.standingsUpdated}`);
if (importedDetails.length) console.log(`[import-f1-results] imported sessions:\n  - ${importedDetails.join("\n  - ")}`);
if (summary.invalid > 0) process.exitCode = 1;
