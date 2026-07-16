export function validateCurrentWorldCupEnvironment(environment: Record<string, string | undefined>): { databaseUrl: string; oddsApiKey: string } {
  const missing = ["DATABASE_URL", "THE_ODDS_API_KEY"].filter((key) => !environment[key]?.trim());
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  return { databaseUrl: environment.DATABASE_URL!.trim(), oddsApiKey: environment.THE_ODDS_API_KEY!.trim() };
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
