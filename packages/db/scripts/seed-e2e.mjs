/** E2E seed: one submittable football fixture for the Playwright journeys
 *  (closing-race, host-operations submission wall). Idempotent — re-runs
 *  refresh the kickoff so the fixture is always SCHEDULED in the future.
 *
 *  Uses the PLATFORM fixed-odds supplier shape (packages/supplier writes the
 *  same rows in production): no odds-staleness window applies, and the odds
 *  snapshot version matches the market's current_version so a REAL ticket
 *  submission verifies end-to-end. Never run against a production database.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

// Optional COMMUNITY_MODERATOR fixture (Story 12.3; the 11.3 journeys had no
// moderator actor). Seeded only when both variables are set — the moderator
// journey specs self-skip without them. Never runs against production: this
// script is for throwaway e2e databases only.
const moderatorUsername = process.env.E2E_MODERATOR_USERNAME?.trim().toLowerCase();
const moderatorPassword = process.env.E2E_MODERATOR_PASSWORD;
if (moderatorUsername && !/^[a-z0-9_]{3,32}$/.test(moderatorUsername)) throw new Error("E2E_MODERATOR_USERNAME must use 3-32 lowercase letters, numbers, or underscores");
if (moderatorPassword && (moderatorPassword.length < 12 || moderatorPassword.length > 128)) throw new Error("E2E_MODERATOR_PASSWORD must contain 12-128 characters");

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
    await tx`SELECT pg_advisory_xact_lock(hashtext('pulse_e2e_seed'))`;

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

  if (moderatorUsername && moderatorPassword) {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('pulse_e2e_seed_moderator'))`;
      // The grant table forbids self-grants, so the fixture needs a distinct
      // granting account. It is inert: random unknown password and
      // must_change_password=true both keep it unusable for login.
      const grantorName = "e2e_grant_registry";
      const inertHash = createHash("sha256").update(randomBytes(32)).digest("hex");
      let [grantor] = await tx`SELECT id FROM identity.users WHERE username_canonical = ${grantorName}`;
      if (!grantor) {
        grantor = { id: randomUUID() };
        await tx`INSERT INTO identity.users (id,username_canonical,password_hash,recovery_code_hash,nickname,status,is_super_admin,must_change_password,created_at,updated_at)
          VALUES (${grantor.id},${grantorName},${inertHash},${inertHash},${grantorName},'ACTIVE',false,true,now(),now())`;
      }
      // Idempotent re-runs refresh the password so rotated credentials land.
      const passwordHash = await hash(moderatorPassword, { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 });
      let [moderator] = await tx`SELECT id FROM identity.users WHERE username_canonical = ${moderatorUsername}`;
      if (moderator) {
        await tx`UPDATE identity.users SET password_hash = ${passwordHash}, status = 'ACTIVE', must_change_password = false, updated_at = now() WHERE id = ${moderator.id}`;
      } else {
        moderator = { id: randomUUID() };
        await tx`INSERT INTO identity.users (id,username_canonical,password_hash,recovery_code_hash,nickname,status,is_super_admin,must_change_password,created_at,updated_at)
          VALUES (${moderator.id},${moderatorUsername},${passwordHash},${createHash("sha256").update(randomBytes(32)).digest("hex")},${moderatorUsername},'ACTIVE',false,false,now(),now())`;
      }
      await tx`INSERT INTO identity.operator_role_grants (id,user_id,role,granted_by,granted_at)
        VALUES (${randomUUID()},${moderator.id},'COMMUNITY_MODERATOR',${grantor.id},now())
        ON CONFLICT (user_id, role) WHERE revoked_at IS NULL DO NOTHING`;
    });
    process.stdout.write(`e2e moderator fixture ready; username=${moderatorUsername}\n`);
  } else {
    process.stdout.write("e2e moderator fixture skipped (set E2E_MODERATOR_USERNAME / E2E_MODERATOR_PASSWORD to seed it)\n");
  }

  process.stdout.write(`e2e seed complete; fixture=${FIXTURE_ID} kickoff=${kickoffAt}\n`);
} finally { await sql.end(); }
