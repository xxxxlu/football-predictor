/** Data-level production invariants, asserted after every scheduled sweep.
 *
 *  Process health (`/api/health/*`) cannot see the failure that actually hurts:
 *  the sweep running green while doing nothing useful. On 2026-07-25 the schedule
 *  had been syncing a competition that finished on 2026-07-19 — every run
 *  succeeded, the match list silently froze, and no ticket could settle. Each
 *  check below encodes one of those silent failures.
 *
 *  Read-only. Env: DATABASE_URL (required), plus optional overrides
 *  HEALTH_MIN_UPCOMING_FIXTURES, HEALTH_MAX_SYNC_AGE_HOURS,
 *  HEALTH_MAX_SETTLEMENT_LAG_HOURS, HEALTH_MAX_F1_LOCK_LAG_HOURS.
 *  Exit code 0 = all invariants hold, 1 = at least one violated. */
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const positive = (name, fallback) => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${name} "${raw}": expected a positive number`);
  return value;
};

const minUpcomingFixtures = positive("HEALTH_MIN_UPCOMING_FIXTURES", 1);
const maxSyncAgeHours = positive("HEALTH_MAX_SYNC_AGE_HOURS", 12);
const maxSettlementLagHours = positive("HEALTH_MAX_SETTLEMENT_LAG_HOURS", 6);
const maxF1LockLagHours = positive("HEALTH_MAX_F1_LOCK_LAG_HOURS", 6);

const sql = postgres(databaseUrl, { ssl: databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1") ? undefined : "require", max: 1 });
const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail });

try {
  /* 1. A live football feed. Zero upcoming fixtures means the configured
        competitions are finished or wrong — the exact 2026-07-25 outage. */
  const [feed] = await sql`
    SELECT
      count(*) FILTER (WHERE status='SCHEDULED' AND kickoff_at > now()) AS upcoming,
      max(captured_at) AS last_captured_at,
      (SELECT kickoff_at FROM supplier.fixtures WHERE status='SCHEDULED' AND kickoff_at > now() ORDER BY kickoff_at LIMIT 1) AS next_kickoff_at
    FROM supplier.fixtures`;
  const upcoming = Number(feed.upcoming);
  record(
    "football feed has upcoming fixtures",
    upcoming >= minUpcomingFixtures,
    `upcoming=${upcoming} (min ${minUpcomingFixtures}), next kickoff ${feed.next_kickoff_at?.toISOString() ?? "none"}`,
  );

  /* 2. The sweep is actually writing. captured_at advances on every persisted
        fixture snapshot, so a stale maximum means the job stopped running. */
  const lastCapturedAt = feed.last_captured_at ? new Date(feed.last_captured_at) : null;
  const syncAgeHours = lastCapturedAt ? (Date.now() - lastCapturedAt.getTime()) / 3_600_000 : Number.POSITIVE_INFINITY;
  record(
    "football fixtures synced recently",
    syncAgeHours <= maxSyncAgeHours,
    `last capture ${lastCapturedAt?.toISOString() ?? "never"} (${syncAgeHours === Number.POSITIVE_INFINITY ? "never" : syncAgeHours.toFixed(1) + "h"} ago, max ${maxSyncAgeHours}h)`,
  );

  /* 3. No settlement starvation: a confirmed football result must not leave
        tickets pending. Catches a settlement scan that never runs. */
  const [football] = await sql`
    SELECT count(*) AS stuck FROM prediction.tickets t
    JOIN supplier.fixtures f ON f.id = t.fixture_id
    WHERE t.status='PENDING' AND f.status='FINISHED' AND f.result_confirmed
      AND f.kickoff_at < now() - ${`${maxSettlementLagHours} hours`}::interval`;
  record(
    "no football tickets pending on a confirmed result",
    Number(football.stuck) === 0,
    `stuck=${football.stuck} (grace ${maxSettlementLagHours}h)`,
  );

  /* 4. Same for F1, whose results arrive through the scheduled import. */
  const [f1Tickets] = await sql`
    SELECT count(*) AS stuck FROM prediction.tickets t
    JOIN f1.markets m ON m.id = t.market_id
    JOIN f1.sessions s ON s.id = m.session_id
    WHERE t.status='PENDING' AND s.state IN ('FINISHED','CANCELLED') AND s.result_confirmed
      AND s.starts_at < now() - ${`${maxSettlementLagHours} hours`}::interval`;
  record(
    "no F1 tickets pending on a confirmed result",
    Number(f1Tickets.stuck) === 0,
    `stuck=${f1Tickets.stuck} (grace ${maxSettlementLagHours}h)`,
  );

  /* 5. F1 session locking runs: a started session must not still be UPCOMING,
        or the UI keeps presenting its markets as open. */
  const [f1Lock] = await sql`
    SELECT count(*) AS unlocked FROM f1.sessions
    WHERE state='UPCOMING' AND starts_at < now() - ${`${maxF1LockLagHours} hours`}::interval`;
  record(
    "no started F1 session left unlocked",
    Number(f1Lock.unlocked) === 0,
    `unlocked=${f1Lock.unlocked} (grace ${maxF1LockLagHours}h)`,
  );
} finally {
  await sql.end({ timeout: 5 });
}

for (const result of results) {
  console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name} — ${result.detail}`);
}
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} production invariants hold.`);
if (failed.length > 0) {
  for (const result of failed) console.log(`::error::${result.name}: ${result.detail}`);
  process.exitCode = 1;
}
