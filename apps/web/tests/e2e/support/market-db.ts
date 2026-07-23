/** Tech debt #21 — real server-side repricing for the offline-repricing journey.
 *
 *  Mutates the SAME market the e2e seed creates (packages/db/scripts/seed-e2e.mjs):
 *  bump inserts a fresh odds snapshot and flips markets.current_version to it — the
 *  exact write pattern the production supplier sync performs. restore flips the market
 *  back to the seeded version so later spec files submit against the odds they expect
 *  (the runner is serial: workers=1, fullyParallel=false). The bumped snapshot row
 *  stays behind on purpose: tickets recorded at that version keep their historical
 *  odds row, and the seed upsert ignores it.
 */
import postgres from "postgres";

const FIXTURE_ID = "platform:900001";
export const MARKET_ID = `${FIXTURE_ID}:bookmaker:0:market:1`;
export const SEEDED_VERSION = "e2e-odds-v1";
export const SEEDED_HOME_ODDS = "3.00";
export const BUMPED_VERSION = "e2e-odds-v2";
export const BUMPED_HOME_ODDS = "3.60";

const SEEDED_OUTCOMES = [
  { selection: "HOME", supplierLabel: "主胜", decimalOdds: SEEDED_HOME_ODDS },
  { selection: "DRAW", supplierLabel: "平局", decimalOdds: "3.00" },
  { selection: "AWAY", supplierLabel: "客胜", decimalOdds: "3.00" },
];
const BUMPED_OUTCOMES = [
  { selection: "HOME", supplierLabel: "主胜", decimalOdds: BUMPED_HOME_ODDS },
  { selection: "DRAW", supplierLabel: "平局", decimalOdds: "3.30" },
  { selection: "AWAY", supplierLabel: "客胜", decimalOdds: "2.10" },
];

export function databaseAvailable(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

type Outcome = { selection: string; supplierLabel: string; decimalOdds: string };

async function setMarketOdds(version: string, outcomes: Outcome[]): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required to reprice the seeded market");
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const dataAsOf = new Date().toISOString();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO supplier.odds_snapshots
          (market_id, version, supplier, supplier_fixture_id, bookmaker_id, bookmaker_name,
           supplier_market_id, market_name, data_as_of, captured_at, outcomes, source_verified, etag)
        VALUES
          (${MARKET_ID}, ${version}, 'PLATFORM', 900001, 0, '平台固定虚拟积分',
           1, '胜平负固定积分倍率', ${dataAsOf}, ${dataAsOf}, ${tx.json(outcomes)}, true, ${`"e2e-repricing-${version}"`})
        ON CONFLICT (market_id, version) DO UPDATE SET
          data_as_of = EXCLUDED.data_as_of, captured_at = EXCLUDED.captured_at,
          outcomes = EXCLUDED.outcomes, source_verified = true`;
      const updated = await tx`UPDATE supplier.markets
        SET current_version = ${version}, outcomes = ${tx.json(outcomes)},
            data_as_of = ${dataAsOf}, captured_at = ${dataAsOf}, updated_at = now()
        WHERE id = ${MARKET_ID}`;
      if (updated.count !== 1) throw new Error(`seeded e2e market ${MARKET_ID} not found — run pnpm db:seed:e2e first`);
    });
  } finally {
    await sql.end();
  }
}

export const bumpSeededMarketOdds = (): Promise<void> => setMarketOdds(BUMPED_VERSION, BUMPED_OUTCOMES);
export const restoreSeededMarketOdds = (): Promise<void> => setMarketOdds(SEEDED_VERSION, SEEDED_OUTCOMES);
