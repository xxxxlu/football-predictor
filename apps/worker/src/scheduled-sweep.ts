import type { SyncCompetition } from "@pulse/supplier";

/** Default when OPENLIGADB_COMPETITIONS is unset: the live German football season.
 *  It must always name competitions that still have upcoming fixtures — a finished
 *  competition (the 2026 World Cup ended 2026-07-19) makes the sweep a no-op, which
 *  silently freezes the match list and starves settlement of results.
 *
 *  Real bookmaker odds are attached to the three league tiers only. Every distinct
 *  oddsSportKey costs one The-Odds-API credit per REAL_ODDS_SYNC_INTERVAL_MS, so the
 *  cup competitions run on the clearly labelled platform multiplier instead. */
export const DEFAULT_OPENLIGADB_COMPETITIONS: readonly SyncCompetition[] = [
  { shortcut: "bl1", season: 2026, oddsSportKey: "soccer_germany_bundesliga" },
  { shortcut: "bl2", season: 2026, oddsSportKey: "soccer_germany_bundesliga2" },
  { shortcut: "bl3", season: 2026, oddsSportKey: "soccer_germany_liga3" },
  { shortcut: "dfb", season: 2026 },
  { shortcut: "BLSupercup", season: 2026 },
];

/**
 * Parses OPENLIGADB_COMPETITIONS: comma-separated `shortcut:season[:oddsSportKey]` entries,
 * e.g. "bl1:2026:soccer_germany_bundesliga,bl2:2026:soccer_germany_bundesliga2,dfb:2026".
 */
export function parseOpenLigaDbCompetitions(raw: string | undefined): SyncCompetition[] {
  if (!raw?.trim()) return [...DEFAULT_OPENLIGADB_COMPETITIONS];
  const entries = raw.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (entries.length === 0) return [...DEFAULT_OPENLIGADB_COMPETITIONS];
  return entries.map((entry) => {
    const parts = entry.split(":").map((part) => part.trim());
    const [shortcut, seasonText, oddsSportKey] = parts;
    const season = Number(seasonText);
    const valid = (parts.length === 2 || parts.length === 3)
      && Boolean(shortcut)
      && /^\d{4}$/.test(seasonText ?? "")
      && Number.isSafeInteger(season)
      && (parts.length === 2 || Boolean(oddsSportKey));
    if (!valid) {
      throw new Error(`Invalid OPENLIGADB_COMPETITIONS entry "${entry}": expected "shortcut:season" or "shortcut:season:oddsSportKey" (e.g. "bl1:2026:soccer_germany_bundesliga")`);
    }
    return oddsSportKey ? { shortcut: shortcut!, season, oddsSportKey } : { shortcut: shortcut!, season };
  });
}

/** Optional override for the real-odds refresh cadence. Unset keeps the supplier
 *  default, which is sized for The-Odds-API's free credit allowance. */
export function parseOddsSyncIntervalMs(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const minutes = Number(raw.trim());
  if (!Number.isSafeInteger(minutes) || minutes <= 0) {
    throw new Error(`Invalid ODDS_SYNC_INTERVAL_MINUTES "${raw.trim()}": expected a positive whole number of minutes`);
  }
  return minutes * 60_000;
}

export function validateScheduledSweepEnvironment(environment: Record<string, string | undefined>): { databaseUrl: string; oddsApiKey: string; competitions: SyncCompetition[]; oddsSyncIntervalMs: number | undefined } {
  const missing = ["DATABASE_URL", "THE_ODDS_API_KEY"].filter((key) => !environment[key]?.trim());
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  return {
    databaseUrl: environment.DATABASE_URL!.trim(),
    oddsApiKey: environment.THE_ODDS_API_KEY!.trim(),
    competitions: parseOpenLigaDbCompetitions(environment.OPENLIGADB_COMPETITIONS),
    oddsSyncIntervalMs: parseOddsSyncIntervalMs(environment.ODDS_SYNC_INTERVAL_MINUTES),
  };
}

type FootballSync = {
  run(): Promise<unknown>;
};

type SettlementSweeper = {
  scan(limit: number): Promise<unknown>;
  /** Optional so a football-only composition stays usable. */
  lockDueF1Sessions?(limit: number): Promise<unknown>;
};

/**
 * One production sweep: refresh football fixtures and odds, close the markets of
 * F1 sessions whose start time has passed, then settle everything that now has a
 * confirmed result. This mirrors the resident worker's scheduler for deployments
 * that only run scheduled invocations instead of a long-lived worker process.
 *
 * A supplier failure never skips the F1 lock or settlement — already-confirmed
 * results must still be paid out — but it is rethrown so the run is reported red.
 */
export async function runScheduledSweepJob(input: {
  sync: FootballSync;
  settlement: SettlementSweeper;
  settlementBatchSize?: number;
}): Promise<{ supplier: unknown; f1SessionLock: unknown; settlement: unknown }> {
  const batchSize = input.settlementBatchSize ?? 500;
  let supplier: unknown;
  let syncError: unknown;
  try {
    supplier = await input.sync.run();
  } catch (error) {
    syncError = error;
  }
  const lockDueF1Sessions = input.settlement.lockDueF1Sessions?.bind(input.settlement);
  const f1SessionLock = lockDueF1Sessions ? await lockDueF1Sessions(batchSize) : null;
  const settlement = await input.settlement.scan(batchSize);
  if (syncError) throw syncError;
  return { supplier, f1SessionLock, settlement };
}
