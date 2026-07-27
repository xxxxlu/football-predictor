import { describe, expect, it } from "vitest";
import { ConfigError, loadIdentityConfig, loadServerConfig, loadSupplierWorkerConfig } from "./index.js";

describe("loadServerConfig", () => {
  it("parses a valid runtime environment", () => {
    expect(loadServerConfig({ APP_ENV: "test", APP_VERSION: "1.2.3", LOG_LEVEL: "debug" })).toEqual({
      appEnv: "test",
      appVersion: "1.2.3",
      logLevel: "debug",
    });
  });

  it("fails without required keys and never includes secret values", () => {
    const secret = "never-log-this";
    expect(() => loadServerConfig({ APP_ENV: "invalid", API_FOOTBALL_KEY: secret })).toThrow(ConfigError);
    try {
      loadServerConfig({ APP_ENV: "invalid", API_FOOTBALL_KEY: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).toContain("APP_ENV");
      expect(String(error)).toContain("APP_VERSION");
    }
  });
});

describe("loadSupplierWorkerConfig", () => {
  it("parses multiple configured competitions", () => {
    const config = loadSupplierWorkerConfig({
      DATABASE_URL: "postgres://app:secret@localhost/app",
      API_FOOTBALL_KEY: "supplier-secret",
      SUPPLIER_COMPETITIONS: "39:2026, 140:2026,2:2026",
      API_FOOTBALL_BOOKMAKER_ID: "8",
    });

    expect(config.competitions).toEqual([
      { leagueId: 39, season: 2026 },
      { leagueId: 140, season: 2026 },
      { leagueId: 2, season: 2026 },
    ]);
  });

  it("keeps the legacy league and season variables compatible", () => {
    const config = loadSupplierWorkerConfig({
      DATABASE_URL: "postgres://app:secret@localhost/app",
      API_FOOTBALL_KEY: "supplier-secret",
      SUPPLIER_LEAGUE_ID: "39",
      SUPPLIER_SEASON: "2026",
      API_FOOTBALL_BOOKMAKER_ID: "8",
    });

    expect(config.competitions).toEqual([{ leagueId: 39, season: 2026 }]);
  });

  it("ignores blank legacy variables when multi-competition config is present", () => {
    const config = loadSupplierWorkerConfig({
      DATABASE_URL: "postgres://app:secret@localhost/app",
      API_FOOTBALL_KEY: "supplier-secret",
      SUPPLIER_COMPETITIONS: "39:2024,140:2024",
      SUPPLIER_LEAGUE_ID: "",
      SUPPLIER_SEASON: "",
      API_FOOTBALL_BOOKMAKER_ID: "8",
    });

    expect(config.competitions).toEqual([
      { leagueId: 39, season: 2024 },
      { leagueId: 140, season: 2024 },
    ]);
  });

  it("accepts an optional historical reference date for bounded backfills", () => {
    const config = loadSupplierWorkerConfig({
      DATABASE_URL: "postgres://app:secret@localhost/app",
      API_FOOTBALL_KEY: "supplier-secret",
      SUPPLIER_COMPETITIONS: "253:2024",
      SUPPLIER_REFERENCE_DATE: "2024-10-14",
      API_FOOTBALL_BOOKMAKER_ID: "8",
    });

    expect(config.referenceDate).toBe("2024-10-14");
  });

  it("rejects a non-calendar historical reference date before supplier work starts", () => {
    expect(() => loadSupplierWorkerConfig({
      DATABASE_URL: "postgres://app:secret@localhost/app",
      API_FOOTBALL_KEY: "supplier-secret",
      SUPPLIER_COMPETITIONS: "253:2024",
      SUPPLIER_REFERENCE_DATE: "2024-99-99",
      API_FOOTBALL_BOOKMAKER_ID: "8",
    })).toThrow(ConfigError);
  });

  it("rejects malformed or duplicate configured competitions", () => {
    const base = {
      DATABASE_URL: "postgres://app:secret@localhost/app",
      API_FOOTBALL_KEY: "supplier-secret",
      API_FOOTBALL_BOOKMAKER_ID: "8",
    };
    expect(() => loadSupplierWorkerConfig({ ...base, SUPPLIER_COMPETITIONS: "39:2026,broken" })).toThrow(ConfigError);
    expect(() => loadSupplierWorkerConfig({ ...base, SUPPLIER_COMPETITIONS: "39:2026,39:2026" })).toThrow(ConfigError);
  });

  it("maps required supplier settings and executable scheduling defaults", () => {
    expect(loadSupplierWorkerConfig({
      DATABASE_URL: "postgres://app:secret@localhost/app",
      API_FOOTBALL_KEY: "supplier-secret",
      SUPPLIER_LEAGUE_ID: "39",
      SUPPLIER_SEASON: "2026",
      API_FOOTBALL_BOOKMAKER_ID: "8",
    })).toEqual({
      databaseUrl: "postgres://app:secret@localhost/app",
      apiFootballKey: "supplier-secret",
      apiFootballBaseUrl: "https://v3.football.api-sports.io",
      competitions: [{ leagueId: 39, season: 2026 }],
      bookmakerId: 8,
      pastDays: 1,
      futureDays: 7,
      fixturesIntervalMs: 43_200_000,
      resultsIntervalMs: 86_400_000,
      oddsIntervalMs: 600_000,
      settlementIntervalMs: 60_000,
      liveEnabled: false,
      liveIntervalMs: 300_000,
      settlementBatchSize: 100,
      f1ResultsSyncEnabled: true,
      f1ResultsIntervalMs: 300_000,
      f1ResultsSeason: 2026,
      jolpicaBaseUrl: "https://api.jolpi.ca/ergast",
    });
  });

  it("fails fast on missing required settings without exposing secrets", () => {
    const secret = "do-not-log-supplier-key";
    try {
      loadSupplierWorkerConfig({ API_FOOTBALL_KEY: secret });
      throw new Error("expected configuration failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(String(error)).not.toContain(secret);
      expect(String(error)).toContain("DATABASE_URL");
      expect(String(error)).toContain("SUPPLIER_COMPETITIONS");
    }
  });
});

describe("loadIdentityConfig", () => {
  it("requires a PostgreSQL URL and current rules version without exposing values in errors", () => {
    expect(loadIdentityConfig({ DATABASE_URL: "postgres://app:secret@localhost/app", RULES_VERSION: "rules-2026-07" })).toEqual({
      databaseUrl: "postgres://app:secret@localhost/app",
      rulesVersion: "rules-2026-07",
      sessionTtlMs: 2_592_000_000,
    });
    const secret = "postgres://app:do-not-print@localhost/app";
    expect(() => loadIdentityConfig({ DATABASE_URL: secret })).toThrowError(expect.not.objectContaining({ message: expect.stringContaining(secret) }));
  });
});
