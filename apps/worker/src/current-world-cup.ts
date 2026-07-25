import type { SyncCompetition } from "@pulse/supplier";

/** Default when OPENLIGADB_COMPETITIONS is unset: exactly the historical World Cup 2026 behavior. */
export const DEFAULT_OPENLIGADB_COMPETITIONS: readonly SyncCompetition[] = [
  { shortcut: "wm26", season: 2026, oddsSportKey: "soccer_fifa_world_cup" },
];

/**
 * Parses OPENLIGADB_COMPETITIONS: comma-separated `shortcut:season[:oddsSportKey]` entries,
 * e.g. "wm26:2026:soccer_fifa_world_cup,bl1:2026:soccer_germany_bundesliga,dfb:2026".
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

export function validateCurrentWorldCupEnvironment(environment: Record<string, string | undefined>): { databaseUrl: string; oddsApiKey: string; competitions: SyncCompetition[] } {
  const missing = ["DATABASE_URL", "THE_ODDS_API_KEY"].filter((key) => !environment[key]?.trim());
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  return {
    databaseUrl: environment.DATABASE_URL!.trim(),
    oddsApiKey: environment.THE_ODDS_API_KEY!.trim(),
    competitions: parseOpenLigaDbCompetitions(environment.OPENLIGADB_COMPETITIONS),
  };
}

type CurrentWorldCupSync = {
  run(): Promise<unknown>;
};

type SettlementScanner = {
  scan(limit: number): Promise<unknown>;
};

export async function runCurrentWorldCupJob(input: {
  sync: CurrentWorldCupSync;
  settlement: SettlementScanner;
  settlementBatchSize?: number;
}): Promise<{ supplier: unknown; settlement: unknown }> {
  let supplier: unknown;
  let syncError: unknown;
  try {
    supplier = await input.sync.run();
  } catch (error) {
    syncError = error;
  }
  const settlement = await input.settlement.scan(input.settlementBatchSize ?? 500);
  if (syncError) throw syncError;
  return { supplier, settlement };
}
