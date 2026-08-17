import { describe, expect, it, vi } from "vitest";
import { createReadyResponse } from "./route";
import { probeDatabase, READINESS_DB_TIMEOUTS, type DatabaseProbeFactory } from "./readiness";

const environment = { APP_ENV: "test", APP_VERSION: "1.0.0", DATABASE_URL: "postgresql://user:secret@localhost/app", RULES_VERSION: "phase-1" };

describe("GET /api/health/ready", () => {
  it("returns ready only after database and migration checks pass", async () => {
    const response = await createReadyResponse(environment, "ready-id", { migrations: async () => ["0001.sql", "0002.sql"], probe: async () => ({ expectedCount: 2, appliedCount: 2, latestExpected: "0002.sql", latestApplied: "0002.sql" }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { status: "ready", checks: [{ name: "configuration" }, { name: "database" }, { name: "migrations", appliedCount: 2, latest: "0002.sql" }] }, meta: { correlationId: "ready-id" } });
  });

  it("returns a no-store 503 without exposing the DSN or raw database error", async () => {
    const response = await createReadyResponse(environment, "unready-id", { migrations: async () => ["0001.sql"], probe: async () => { throw new Error(`could not connect ${environment.DATABASE_URL}`); } });
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ error: { code: "SERVICE_NOT_READY", correlationId: "unready-id" } });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(body)).not.toContain("could not connect");
  });
});

describe("database readiness probe", () => {
  it("uses bounded connection, statement and close timeouts", () => {
    expect(READINESS_DB_TIMEOUTS).toEqual({ connectSeconds: 3, statementMilliseconds: 3_000, lockMilliseconds: 1_000, closeSeconds: 1 });
  });
  it("releases the short-lived connection after success", async () => {
    const close = vi.fn(async () => undefined);
    const factory: DatabaseProbeFactory = () => ({ ping: async () => undefined, appliedMigrations: async () => ["0001.sql", "0002.sql"], close });
    await expect(probeDatabase(environment.DATABASE_URL, ["0001.sql", "0002.sql"], factory)).resolves.toMatchObject({ appliedCount: 2, latestApplied: "0002.sql" });
    expect(close).toHaveBeenCalledOnce();
  });

  /*
   * The pre-deploy migration step puts the database ahead of the version still
   * serving traffic. Treating that as unready took the outgoing version down on
   * every deploy that carried a migration.
   */
  it("stays ready when the database is ahead of this build's manifest", async () => {
    const close = vi.fn(async () => undefined);
    const factory: DatabaseProbeFactory = () => ({ ping: async () => undefined, appliedMigrations: async () => ["0001.sql", "0002.sql", "0003.sql"], close });
    await expect(probeDatabase(environment.DATABASE_URL, ["0001.sql", "0002.sql"], factory)).resolves.toMatchObject({ expectedCount: 2, appliedCount: 3, latestApplied: "0003.sql" });
  });

  it("is unready while a migration this build needs is missing", async () => {
    const close = vi.fn(async () => undefined);
    const factory: DatabaseProbeFactory = () => ({ ping: async () => undefined, appliedMigrations: async () => ["0001.sql"], close });
    await expect(probeDatabase(environment.DATABASE_URL, ["0001.sql", "0002.sql"], factory)).rejects.toThrow("MIGRATIONS_OUT_OF_DATE");
    expect(close).toHaveBeenCalledOnce();
  });

  it("releases the connection when ping or migration validation fails", async () => {
    const close = vi.fn(async () => undefined);
    const factory: DatabaseProbeFactory = () => ({ ping: async () => { throw new Error("timeout"); }, appliedMigrations: async () => [], close });
    await expect(probeDatabase(environment.DATABASE_URL, ["0001.sql"], factory)).rejects.toThrow("timeout");
    expect(close).toHaveBeenCalledOnce();
  });
});
