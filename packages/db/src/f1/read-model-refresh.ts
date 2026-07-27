import postgres from "postgres";
import { createJolpicaF1ResultsSync, type F1ResultsSyncOptions, type F1ResultsSyncSummary } from "./results-sync.js";

export type F1ReadModelRefreshOutcome =
  | { attempted: false }
  | { attempted: true; summary: F1ResultsSyncSummary };

export type F1ReadModelRefreshOptions = Pick<F1ResultsSyncOptions, "season" | "baseUrl" | "now"> & {
  databaseUrl: string;
  minimumIntervalMs: number;
  claim?: (key: string, now: Date, minimumIntervalMs: number) => Promise<boolean>;
  createSync?: typeof createJolpicaF1ResultsSync;
};

/**
 * CloudBase serves only the web process, not the resident worker.  A first F1
 * page read after the interval therefore refreshes the persisted read model.
 * The database claim makes it safe across concurrent function instances and
 * turns all other requests into a single cheap SQL statement.
 */
export async function refreshF1ReadModelIfDue(options: F1ReadModelRefreshOptions): Promise<F1ReadModelRefreshOutcome> {
  const now = options.now?.() ?? new Date();
  const key = `f1-results:${options.season}`;
  const claimed = options.claim ?? createDatabaseClaim(options.databaseUrl);
  if (!await claimed(key, now, options.minimumIntervalMs)) return { attempted: false };

  const sync = (options.createSync ?? createJolpicaF1ResultsSync)(options.databaseUrl, {
    season: options.season,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  try {
    return { attempted: true, summary: await sync.sync() };
  } finally {
    await sync.close();
  }
}

function createDatabaseClaim(databaseUrl: string) {
  return async (key: string, now: Date, minimumIntervalMs: number): Promise<boolean> => {
    const sql = postgres(databaseUrl, { max: 1, prepare: false });
    try {
      const safeIntervalMs = Math.max(0, Math.trunc(minimumIntervalMs));
      const cutoff = new Date(now.getTime() - safeIntervalMs);
      const rows = await sql<Array<{ claimed: boolean }>>`
        INSERT INTO supplier.external_sync_claims (sync_key,last_attempt_at,updated_at)
        VALUES (${key},${now},${now})
        ON CONFLICT (sync_key) DO UPDATE
          SET last_attempt_at=EXCLUDED.last_attempt_at,updated_at=EXCLUDED.updated_at
        WHERE supplier.external_sync_claims.last_attempt_at <= ${cutoff}
        RETURNING true AS claimed`;
      return rows[0]?.claimed === true;
    } finally {
      await sql.end();
    }
  };
}
