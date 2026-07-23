/** Automatic F1 lock-at-start (§12.5): predictions close exactly at the session
 *  start (Q1 start / lights out). The worker drives this from persisted state —
 *  a session is due when `starts_at <= now` and it is still UPCOMING — so a
 *  restart recovers naturally: the first sweep after boot locks everything the
 *  downtime missed. No in-memory timers to lose. */

export interface F1DueSession {
  id: string;
  startsAt: string;
}

export type F1SessionLockOutcome =
  /** Session moved UPCOMING → LOCKED and its OPEN markets were closed. */
  | { sessionId: string; outcome: "LOCKED"; marketsClosed: number }
  /** Another actor got there first (already locked/finished/cancelled, or the
   *  row is currently held by an admin result transaction). Safe no-op. */
  | { sessionId: string; outcome: "SKIPPED" }
  | { sessionId: string; outcome: "FAILED"; error: string };

export interface F1SessionLockPort {
  /** Sessions still UPCOMING whose start time has passed, oldest first. */
  listDueSessions(now: Date, limit: number): Promise<F1DueSession[]>;
  /** Atomically re-checks eligibility (state UPCOMING and starts_at <= now)
   *  under a per-session lock, then marks the session LOCKED and closes its
   *  OPEN markets in the same transaction. Returns null when the session is no
   *  longer eligible or its row is busy — both are idempotent no-ops. */
  lockSession(sessionId: string, now: Date): Promise<{ marketsClosed: number } | null>;
}

export interface F1SessionLockSummary {
  outcome: "SUCCESS" | "RETRY";
  locked: number;
  marketsClosed: number;
  skipped: number;
  failedSessionIds: string[];
  results: F1SessionLockOutcome[];
}

export class F1SessionLockService {
  constructor(private readonly input: { port: F1SessionLockPort; clock: { now(): Date } }) {}

  /** One sweep. Every due session is attempted independently — a failure on one
   *  never blocks the rest — and re-running the sweep is a no-op for sessions
   *  already handled (the port re-checks state inside its transaction). */
  async run(limit: number): Promise<F1SessionLockSummary> {
    const now = this.input.clock.now();
    const due = await this.input.port.listDueSessions(now, Math.max(1, Math.trunc(limit)));
    const results: F1SessionLockOutcome[] = [];
    for (const session of due) {
      try {
        const locked = await this.input.port.lockSession(session.id, now);
        results.push(locked === null
          ? { sessionId: session.id, outcome: "SKIPPED" }
          : { sessionId: session.id, outcome: "LOCKED", marketsClosed: locked.marketsClosed });
      } catch (error) {
        results.push({ sessionId: session.id, outcome: "FAILED", error: error instanceof Error ? error.name : "UnknownError" });
      }
    }
    const failedSessionIds = results.flatMap((result) => (result.outcome === "FAILED" ? [result.sessionId] : []));
    return {
      outcome: failedSessionIds.length > 0 ? "RETRY" : "SUCCESS",
      locked: results.filter((result) => result.outcome === "LOCKED").length,
      marketsClosed: results.reduce((total, result) => total + (result.outcome === "LOCKED" ? result.marketsClosed : 0), 0),
      skipped: results.filter((result) => result.outcome === "SKIPPED").length,
      failedSessionIds,
      results,
    };
  }
}
