/** Dev seed for the F1 2026 model: entry list, three race weekends and open markets
 *  with formula-priced odds. Idempotent — safe to re-run; each run publishes a new
 *  odds version. Requires the domain package to be built (pnpm build) because the
 *  entry list and H2H pricing formula are imported from it, not duplicated here. */
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { F1_CONSTRUCTORS_2026, F1_DRIVERS_2026, f1MarketKindsForSession, h2hOdds } from "@football-predictor/domain";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

/** Plausible mid-season points for dev pricing only — not real standings. */
const SEED_POINTS = {
  NOR: 241, PIA: 218, VER: 187, RUS: 152, LEC: 121, HAM: 104, ANT: 88, ALO: 62,
  SAI: 48, ALB: 44, HAD: 39, GAS: 30, HUL: 26, OCO: 22, LAW: 18, STR: 14,
  BEA: 12, LIN: 8, BOR: 6, COL: 4, PER: 3, BOT: 1,
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

function outcomesFor(kind) {
  if (kind === "POLE" || kind === "WINNER") {
    return topDrivers.map((driver) => ({ selection: `DRV:${driver.code}`, decimalOdds: fieldOdds(driver.code, 60) }));
  }
  if (kind === "PODIUM") {
    return topDrivers.flatMap((driver) => {
      const yes = Number(fieldOdds(driver.code, 60));
      const yesOdds = clamp(1.15, 25, yes / 3);
      const noOdds = clamp(1.02, 8, 1 / (1 - 0.94 / yesOdds));
      return [
        { selection: `PODIUM:${driver.code}:YES`, decimalOdds: yesOdds.toFixed(2) },
        { selection: `PODIUM:${driver.code}:NO`, decimalOdds: noOdds.toFixed(2) },
      ];
    });
  }
  if (kind === "EXACT_PODIUM") {
    const contenders = topDrivers.slice(0, 5);
    const combos = [];
    for (const first of contenders) for (const second of contenders) for (const third of contenders) {
      if (new Set([first.code, second.code, third.code]).size !== 3) continue;
      const combined = Number(fieldOdds(first.code, 60)) * Number(fieldOdds(second.code, 60)) * Number(fieldOdds(third.code, 60));
      combos.push({ selection: `POD3:${first.code}-${second.code}-${third.code}`, decimalOdds: clamp(6, 500, combined / 2.5).toFixed(2) });
    }
    return combos;
  }
  // H2H: teammate duels, both directions, priced by the shared domain formula.
  return F1_CONSTRUCTORS_2026.flatMap((constructor) => {
    const [a, b] = F1_DRIVERS_2026.filter((driver) => driver.constructorKey === constructor.key);
    if (!a || !b) return [];
    const { oddsA, oddsB } = h2hOdds({ pointsA: points(a.code), pointsB: points(b.code) });
    return [
      { selection: `H2H:${a.code}>${b.code}`, decimalOdds: oddsA },
      { selection: `H2H:${b.code}>${a.code}`, decimalOdds: oddsB },
    ];
  });
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const oddsVersion = `seed-${randomUUID().slice(0, 8)}`;
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('football_predictor_f1_seed'))`;

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
