import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

export type MigrationState = { expectedCount: number; appliedCount: number; latestExpected: string; latestApplied: string | null };
export type DatabaseProbe = { ping(): Promise<void>; appliedMigrations(): Promise<string[]>; close(): Promise<void> };
export type DatabaseProbeFactory = (databaseUrl: string) => DatabaseProbe;
export const READINESS_DB_TIMEOUTS = { connectSeconds: 3, statementMilliseconds: 3_000, lockMilliseconds: 1_000, closeSeconds: 1 } as const;

export const createPostgresProbe: DatabaseProbeFactory = (databaseUrl) => {
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: READINESS_DB_TIMEOUTS.connectSeconds,
    idle_timeout: 1,
    max_lifetime: 5,
    connection: { application_name: "pulse-readiness", statement_timeout: READINESS_DB_TIMEOUTS.statementMilliseconds, lock_timeout: READINESS_DB_TIMEOUTS.lockMilliseconds },
  });
  return {
    ping: async () => { await sql`SELECT 1`; },
    appliedMigrations: async () => (await sql<{ name: string }[]>`SELECT name FROM public.app_schema_migrations ORDER BY name`).map((row) => row.name),
    close: async () => { await sql.end({ timeout: READINESS_DB_TIMEOUTS.closeSeconds }); },
  };
};

export async function expectedMigrations(cwd: string = process.cwd()): Promise<string[]> {
  const candidates = [resolve(cwd, "packages/db/migrations"), resolve(cwd, "../../packages/db/migrations")];
  for (const directory of candidates) {
    try { return (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort(); }
    catch { /* Try the next supported monorepo working directory. */ }
  }
  throw new Error("MIGRATION_MANIFEST_UNAVAILABLE");
}

/**
 * Ready when every migration this build needs has been applied.
 *
 * The danger this guards against is one-directional: code that queries a table
 * or column its migration has not created. A database that is *ahead* of the
 * build is not that failure — and it is the normal state during a deployment.
 * `render.yaml` runs `pnpm db:migrate` as the pre-deploy step, before any new
 * instance starts, while the previous version is still taking traffic; that
 * version's manifest cannot contain the migration that just ran. Demanding exact
 * equality therefore made the *outgoing* version fail `healthCheckPath` on every
 * deploy that carried a migration — the one moment the service is meant to stay
 * up. Reversing the deploy order does not help: then the incoming version is the
 * unready one until migrations land.
 *
 * Presence, not position: the runner applies the whole sorted set inside one
 * transaction (packages/db/scripts/migrate.mjs), so ordering is guaranteed by
 * construction and an index-wise comparison only added a second way to fail.
 */
export async function probeDatabase(databaseUrl: string, expected: string[], factory: DatabaseProbeFactory = createPostgresProbe): Promise<MigrationState> {
  if (expected.length === 0) throw new Error("MIGRATION_MANIFEST_EMPTY");
  const probe = factory(databaseUrl);
  try {
    await probe.ping();
    const applied = await probe.appliedMigrations();
    const appliedNames = new Set(applied);
    if (expected.some((name) => !appliedNames.has(name))) throw new Error("MIGRATIONS_OUT_OF_DATE");
    return {
      expectedCount: expected.length,
      appliedCount: applied.length,
      latestExpected: expected.at(-1)!,
      latestApplied: applied.at(-1) ?? null,
    };
  } finally {
    await probe.close();
  }
}
