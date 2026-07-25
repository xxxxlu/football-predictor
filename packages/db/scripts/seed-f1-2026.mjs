/** Dev seed for the F1 2026 model: entry list, three race weekends and open markets
 *  with formula-priced odds. Idempotent — safe to re-run; each run publishes a new
 *  odds version. Requires the domain package to be built (pnpm build) because the
 *  entry list and H2H pricing formula are imported from it, not duplicated here. */
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { F1_CONSTRUCTORS_2026, F1_DRIVERS_2026, f1MarketKindsForSession } from "@pulse/domain";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

/** Official 2026 driver standings snapshot used for the current F1 pricing/ordering. */
const SEED_POINTS = {
  ANT: 204, HAM: 159, RUS: 154, LEC: 126, NOR: 103, PIA: 92, VER: 91, HAD: 60,
  GAS: 42, LAW: 39, LIN: 22, COL: 19, BEA: 18, BOR: 10, SAI: 6, ALB: 5,
  OCO: 3, ALO: 1, HUL: 0, BOT: 0, PER: 0, STR: 0,
};

/** Session times are relative to the run so re-seeding always yields upcoming,
 *  predictable sessions (fixed calendar dates silently aged out — the e2e F1
 *  suite then skipped for lack of an UPCOMING session). The upsert below
 *  refreshes starts_at on conflict, so re-runs push the calendar forward. */
const daysFromNow = (days, hourUtc) => {
  const at = new Date(Date.now() + days * 86_400_000);
  at.setUTCHours(hourUtc, 0, 0, 0);
  return at.toISOString();
};

const WEEKENDS = [
  { season: 2026, round: 12, name: "BRITISH GRAND PRIX", circuitKey: "silverstone", isSprintWeekend: false, finished: true, sessions: [
    { kind: "QUALIFYING", startsAt: daysFromNow(-19, 14) },
    { kind: "GRAND_PRIX", startsAt: daysFromNow(-18, 14) },
  ] },
  { season: 2026, round: 13, name: "HUNGARIAN GRAND PRIX", circuitKey: "hungaroring", isSprintWeekend: false, finished: false, sessions: [
    { kind: "QUALIFYING", startsAt: daysFromNow(8, 14) },
    { kind: "GRAND_PRIX", startsAt: daysFromNow(10, 13) },
  ] },
  { season: 2026, round: 14, name: "DUTCH GRAND PRIX", circuitKey: "zandvoort", isSprintWeekend: true, finished: false, sessions: [
    { kind: "SPRINT_QUALIFYING", startsAt: daysFromNow(29, 14) },
    { kind: "SPRINT", startsAt: daysFromNow(30, 10) },
    { kind: "QUALIFYING", startsAt: daysFromNow(30, 14) },
    { kind: "GRAND_PRIX", startsAt: daysFromNow(31, 13) },
  ] },
];

/** Deterministic UUID from a seed key so re-runs target the same rows. */
function seedUuid(key) {
  const digest = createHash("sha256").update(`f1-seed-2026:${key}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

const clamp = (min, max, value) => Math.min(max, Math.max(min, value));
const points = (code) => SEED_POINTS[code] ?? 0;
const topDrivers = [...F1_DRIVERS_2026].sort((a, b) => points(b.code) - points(a.code));

function fieldOdds(code, cap) {
  const total = topDrivers.reduce((sum, driver) => sum + points(driver.code) + 25, 0);
  const share = (points(code) + 25) / total;
  return clamp(1.15, cap, (1 / share) * 0.94).toFixed(2);
}

/** POLE / WINNER enumerate the field directly. EXACT_PODIUM (领奖台之争) stores the
 *  same per-driver base odds — ordered P1-P2-P3 combos are derived on demand via the
 *  shared domain formula (exactPodiumComboOdds), never enumerated into the snapshot. */
function outcomesFor(kind) {
  if (kind !== "POLE" && kind !== "WINNER" && kind !== "EXACT_PODIUM") {
    throw new Error(`unexpected offered market kind: ${kind}`);
  }
  return topDrivers.map((driver) => ({ selection: `DRV:${driver.code}`, decimalOdds: fieldOdds(driver.code, 60) }));
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const oddsVersion = `seed-${randomUUID().slice(0, 8)}`;
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('pulse_f1_seed'))`;

    for (const constructor of F1_CONSTRUCTORS_2026) {
      await tx`INSERT INTO f1.constructors (key, name, color) VALUES (${constructor.key}, ${constructor.name}, ${constructor.color})
        ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color, updated_at = now()`;
    }
    for (const driver of F1_DRIVERS_2026) {
      await tx`INSERT INTO f1.drivers (code, number, name, constructor_key, active, season_points)
        VALUES (${driver.code}, ${driver.number}, ${driver.name}, ${driver.constructorKey}, ${driver.active}, ${points(driver.code)})
        ON CONFLICT (code) DO UPDATE SET number = EXCLUDED.number, name = EXCLUDED.name,
          constructor_key = EXCLUDED.constructor_key, active = EXCLUDED.active,
          season_points = EXCLUDED.season_points, updated_at = now()`;
    }

    for (const weekend of WEEKENDS) {
      const weekendId = seedUuid(`weekend:${weekend.season}:${weekend.round}`);
      await tx`INSERT INTO f1.race_weekends (id, season, round, name, circuit_key, is_sprint_weekend)
        VALUES (${weekendId}, ${weekend.season}, ${weekend.round}, ${weekend.name}, ${weekend.circuitKey}, ${weekend.isSprintWeekend})
        ON CONFLICT (season, round) DO UPDATE SET name = EXCLUDED.name, circuit_key = EXCLUDED.circuit_key,
          is_sprint_weekend = EXCLUDED.is_sprint_weekend, updated_at = now()`;

      for (const session of weekend.sessions) {
        const sessionId = seedUuid(`session:${weekend.season}:${weekend.round}:${session.kind}`);
        const state = weekend.finished ? "LOCKED" : "UPCOMING";
        await tx`INSERT INTO f1.sessions (id, weekend_id, kind, starts_at, state)
          VALUES (${sessionId}, ${weekendId}, ${session.kind}, ${session.startsAt}, ${state})
          ON CONFLICT (weekend_id, kind) DO UPDATE SET starts_at = EXCLUDED.starts_at, updated_at = now()`;
        if (weekend.finished) continue;

        for (const marketKind of f1MarketKindsForSession(session.kind)) {
          const marketId = `f1:${sessionId}:${marketKind}`;
          await tx`INSERT INTO f1.markets (id, session_id, kind, status)
            VALUES (${marketId}, ${sessionId}, ${marketKind}, 'OPEN') ON CONFLICT (id) DO NOTHING`;
          await tx`INSERT INTO f1.market_odds (market_id, version, data_as_of, outcomes)
            VALUES (${marketId}, ${oddsVersion}, now(), ${tx.json(outcomesFor(marketKind))})`;
          await tx`UPDATE f1.markets SET current_version = ${oddsVersion}, updated_at = now() WHERE id = ${marketId}`;
        }
      }
    }
  });
  process.stdout.write(`f1 seed complete; odds version=${oddsVersion}\n`);
} finally { await sql.end(); }
