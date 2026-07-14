export function validateCurrentWorldCupEnvironment(environment: Record<string, string | undefined>): { databaseUrl: string; oddsApiKey: string } {
  const missing = ["DATABASE_URL", "THE_ODDS_API_KEY"].filter((key) => !environment[key]?.trim());
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  return { databaseUrl: environment.DATABASE_URL!.trim(), oddsApiKey: environment.THE_ODDS_API_KEY!.trim() };
}
