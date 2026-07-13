import { z } from "zod";

const serverConfigSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]),
  APP_VERSION: z.string().trim().min(1).max(100),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ServerConfig = {
  appEnv: z.infer<typeof serverConfigSchema>["APP_ENV"];
  appVersion: string;
  logLevel: z.infer<typeof serverConfigSchema>["LOG_LEVEL"];
};

export class ConfigError extends Error {
  readonly code = "INVALID_SERVER_CONFIG";

  constructor(readonly invalidKeys: readonly string[]) {
    super(`Invalid server configuration: ${invalidKeys.join(", ")}`);
    this.name = "ConfigError";
  }
}

export function loadServerConfig(environment: Record<string, string | undefined>): ServerConfig {
  const result = serverConfigSchema.safeParse(environment);
  if (!result.success) {
    const invalidKeys = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "environment")))].sort();
    throw new ConfigError(invalidKeys);
  }

  return {
    appEnv: result.data.APP_ENV,
    appVersion: result.data.APP_VERSION,
    logLevel: result.data.LOG_LEVEL,
  };
}

const identityConfigSchema = z.object({
  DATABASE_URL: z.string().url().refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://")),
  RULES_VERSION: z.string().trim().min(1).max(100),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
});

export type IdentityConfig = { databaseUrl: string; rulesVersion: string; sessionTtlMs: number };

export function loadIdentityConfig(environment: Record<string, string | undefined>): IdentityConfig {
  const result = identityConfigSchema.safeParse(environment);
  if (!result.success) {
    const invalidKeys = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "environment")))].sort();
    throw new ConfigError(invalidKeys);
  }
  return {
    databaseUrl: result.data.DATABASE_URL,
    rulesVersion: result.data.RULES_VERSION,
    sessionTtlMs: result.data.SESSION_TTL_DAYS * 86_400_000,
  };
}

const supplierWorkerConfigSchema = z.object({
  DATABASE_URL: z.string().url().refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://")),
  API_FOOTBALL_KEY: z.string().trim().min(1),
  API_FOOTBALL_BASE_URL: z.string().url().default("https://v3.football.api-sports.io"),
  SUPPLIER_LEAGUE_ID: z.coerce.number().int().positive(),
  SUPPLIER_SEASON: z.coerce.number().int().min(2000).max(2100),
  API_FOOTBALL_BOOKMAKER_ID: z.coerce.number().int().positive(),
  SUPPLIER_WINDOW_PAST_DAYS: z.coerce.number().int().min(0).max(30).default(1),
  SUPPLIER_WINDOW_FUTURE_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  SUPPLIER_FIXTURES_INTERVAL_MINUTES: z.coerce.number().positive().max(1440).default(60),
  SUPPLIER_ODDS_INTERVAL_MINUTES: z.coerce.number().positive().max(1440).default(10),
  SUPPLIER_SETTLEMENT_INTERVAL_SECONDS: z.coerce.number().positive().max(3600).default(60),
  SUPPLIER_LIVE_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  SUPPLIER_LIVE_INTERVAL_MINUTES: z.coerce.number().positive().max(1440).default(5),
  SUPPLIER_SETTLEMENT_BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(100),
});

export type SupplierWorkerConfig = {
  databaseUrl: string;
  apiFootballKey: string;
  apiFootballBaseUrl: string;
  leagueId: number;
  season: number;
  bookmakerId: number;
  pastDays: number;
  futureDays: number;
  fixturesIntervalMs: number;
  oddsIntervalMs: number;
  settlementIntervalMs: number;
  liveEnabled: boolean;
  liveIntervalMs: number;
  settlementBatchSize: number;
};

export function loadSupplierWorkerConfig(environment: Record<string, string | undefined>): SupplierWorkerConfig {
  const result = supplierWorkerConfigSchema.safeParse(environment);
  if (!result.success) {
    const invalidKeys = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "environment")))].sort();
    throw new ConfigError(invalidKeys);
  }
  return {
    databaseUrl: result.data.DATABASE_URL,
    apiFootballKey: result.data.API_FOOTBALL_KEY,
    apiFootballBaseUrl: result.data.API_FOOTBALL_BASE_URL,
    leagueId: result.data.SUPPLIER_LEAGUE_ID,
    season: result.data.SUPPLIER_SEASON,
    bookmakerId: result.data.API_FOOTBALL_BOOKMAKER_ID,
    pastDays: result.data.SUPPLIER_WINDOW_PAST_DAYS,
    futureDays: result.data.SUPPLIER_WINDOW_FUTURE_DAYS,
    fixturesIntervalMs: result.data.SUPPLIER_FIXTURES_INTERVAL_MINUTES * 60_000,
    oddsIntervalMs: result.data.SUPPLIER_ODDS_INTERVAL_MINUTES * 60_000,
    settlementIntervalMs: result.data.SUPPLIER_SETTLEMENT_INTERVAL_SECONDS * 1000,
    liveEnabled: result.data.SUPPLIER_LIVE_ENABLED,
    liveIntervalMs: result.data.SUPPLIER_LIVE_INTERVAL_MINUTES * 60_000,
    settlementBatchSize: result.data.SUPPLIER_SETTLEMENT_BATCH_SIZE,
  };
}
