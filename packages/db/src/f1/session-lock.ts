import type postgres from "postgres";
import type { F1DueSession, F1SessionLockPort } from "@pulse/domain";

/** Postgres implementation of the automatic lock-at-start port. Eligibility is
 *  re-checked inside a per-session row lock so the sweep serializes with admin
 *  result entry (which also takes FOR UPDATE on the session row); SKIP LOCKED
 *  turns that contention into an idempotent no-op instead of a stall. */
export class PostgresF1SessionLockPort implements F1SessionLockPort {
  constructor(private readonly sql: postgres.Sql) {}

  async listDueSessions(now: Date, limit: number): Promise<F1DueSession[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = await this.sql<Array<{ id: string; startsAt: Date | string }>>`
      SELECT id, starts_at AS "startsAt" FROM f1.sessions
      WHERE state='UPCOMING' AND starts_at <= ${now.toISOString()}
      ORDER BY starts_at, id LIMIT ${safeLimit}`;
    return rows.map((row) => ({ id: row.id, startsAt: new Date(row.startsAt).toISOString() }));
  }

  async lockSession(sessionId: string, now: Date): Promise<{ marketsClosed: number } | null> {
    const nowIso = now.toISOString();
    return this.sql.begin(async (tx) => {
      const [session] = await tx<Array<{ id: string }>>`
        SELECT id FROM f1.sessions
        WHERE id=${sessionId} AND state='UPCOMING' AND starts_at <= ${nowIso}
        FOR UPDATE SKIP LOCKED`;
      if (!session) return null;
      await tx`UPDATE f1.sessions SET state='LOCKED', updated_at=${nowIso} WHERE id=${sessionId}`;
      const closed = await tx<Array<{ id: string }>>`
        UPDATE f1.markets SET status='CLOSED', updated_at=${nowIso}
        WHERE session_id=${sessionId} AND status='OPEN' RETURNING id`;
      return { marketsClosed: closed.length };
    }) as Promise<{ marketsClosed: number } | null>;
  }
}
