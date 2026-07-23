/** E2E seed: one submittable football fixture for the Playwright journeys
 *  (closing-race, host-operations submission wall). Idempotent — re-runs
 *  refresh the kickoff so the fixture is always SCHEDULED in the future.
 *
 *  Uses the PLATFORM fixed-odds supplier shape (packages/supplier writes the
 *  same rows in production): no odds-staleness window applies, and the odds
 *  snapshot version matches the market's current_version so a REAL ticket
 *  submission verifies end-to-end. Never run against a production database.
 */
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const FIXTURE_ID = "platform:900001";
const MARKET_ID = `${FIXTURE_ID}:bookmaker:0:market:1`;
const ODDS_VERSION = "e2e-odds-v1";
const OUTCOMES = [
  { selection: "HOME", supplierLabel: "主胜", decimalOdds: "3.00" },
  { selection: "DRAW", supplierLabel: "平局", decimalOdds: "3.00" },
  { selection: "AWAY", supplierLabel: "客胜", decimalOdds: "3.00" },
];

const kickoffAt = new Date(Date.now() + 6 * 3_600_000).toISOString();
const dataAsOf = new Date(Date.now() - 60_000).toISOString();
const capturedAt = new Date().toISOString();

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('football_predictor_e2e_seed'))`;

    await tx`INSERT INTO supplier.fixtures
        (id, supplier, supplier_fixture_id, competition_id, competition_name, season, kickoff_at, status,
         home_team_id, home_team_name, away_team_id, away_team_name, current_version, data_as_of, captured_at, etag)
      VALUES
        (${FIXTURE_ID}, 'PLATFORM', 900001, 990, 'E2E 测试联赛', 2026, ${kickoffAt}, 'SCHEDULED',
         990010, 'E2E 联队', 990020, 'E2E 城队', 'fixture-v1', ${dataAsOf}, ${capturedAt}, '"seed-e2e-fixture"')
      ON CONFLICT (id) DO UPDATE SET
        kickoff_at = EXCLUDED.kickoff_at, status = 'SCHEDULED', data_as_of = EXCLUDED.data_as_of,
        captured_at = EXCLUDED.captured_at, updated_at = now()`;

    await tx`INSERT INTO supplier.markets
        (id, fixture_id, status, sync_state, supplier, supplier_fixture_id, bookmaker_id, bookmaker_name,
         supplier_market_id, market_name, current_version, data_as_of, captured_at, outcomes, source_verified, etag)
      VALUES
        (${MARKET_ID}, ${FIXTURE_ID}, 'OPEN', 'IDLE', 'PLATFORM', 900001, 0, '平台固定虚拟积分',
         1, '胜平负固定积分倍率', ${ODDS_VERSION}, ${dataAsOf}, ${capturedAt}, ${tx.json(OUTCOMES)}, true, '"seed-e2e-market"')
      ON CONFLICT (id) DO UPDATE SET
        status = 'OPEN', sync_state = 'IDLE', current_version = ${ODDS_VERSION}, data_as_of = EXCLUDED.data_as_of,
        captured_at = EXCLUDED.captured_at, outcomes = EXCLUDED.outcomes, source_verified = true, updated_at = now()`;

    await tx`INSERT INTO supplier.odds_snapshots
        (market_id, version, supplier, supplier_fixture_id, bookmaker_id, bookmaker_name,
         supplier_market_id, market_name, data_as_of, captured_at, outcomes, source_verified, etag)
      VALUES
        (${MARKET_ID}, ${ODDS_VERSION}, 'PLATFORM', 900001, 0, '平台固定虚拟积分',
         1, '胜平负固定积分倍率', ${dataAsOf}, ${capturedAt}, ${tx.json(OUTCOMES)}, true, '"seed-e2e-odds"')
      ON CONFLICT (market_id, version) DO UPDATE SET
        data_as_of = EXCLUDED.data_as_of, captured_at = EXCLUDED.captured_at,
        outcomes = EXCLUDED.outcomes, source_verified = true`;
  });
  process.stdout.write(`e2e seed complete; fixture=${FIXTURE_ID} kickoff=${kickoffAt}\n`);
} finally { await sql.end(); }
