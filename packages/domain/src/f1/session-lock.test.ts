import { describe, expect, it } from "vitest";
import { F1SessionLockService, type F1DueSession, type F1SessionLockPort } from "./session-lock.js";

/** In-memory port mirroring the transactional contract of the Postgres port:
 *  lockSession re-checks state under the hood, so replays and races no-op. */
class FakeLockPort implements F1SessionLockPort {
  readonly sessions = new Map<string, { startsAt: string; state: "UPCOMING" | "LOCKED" | "FINISHED" | "CANCELLED"; openMarkets: number; busy?: boolean }>();
  readonly lockCalls: string[] = [];
  failWith: { sessionId: string; error: Error } | undefined;

  async listDueSessions(now: Date, limit: number): Promise<F1DueSession[]> {
    return [...this.sessions.entries()]
      .filter(([, session]) => session.state === "UPCOMING" && new Date(session.startsAt).getTime() <= now.getTime())
      .sort(([, a], [, b]) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, limit)
      .map(([id, session]) => ({ id, startsAt: session.startsAt }));
  }

  async lockSession(sessionId: string, now: Date): Promise<{ marketsClosed: number } | null> {
    this.lockCalls.push(sessionId);
    if (this.failWith && this.failWith.sessionId === sessionId) throw this.failWith.error;
    const session = this.sessions.get(sessionId);
    if (!session || session.busy) return null;
    if (session.state !== "UPCOMING" || new Date(session.startsAt).getTime() > now.getTime()) return null;
    session.state = "LOCKED";
    const marketsClosed = session.openMarkets;
    session.openMarkets = 0;
    return { marketsClosed };
  }
}

const clockAt = (iso: string) => ({ now: () => new Date(iso) });

describe("F1SessionLockService", () => {
  it("locks every due session and closes its open markets", async () => {
    const port = new FakeLockPort();
    port.sessions.set("quali", { startsAt: "2026-07-31T14:00:00Z", state: "UPCOMING", openMarkets: 3 });
    port.sessions.set("race", { startsAt: "2026-08-02T13:00:00Z", state: "UPCOMING", openMarkets: 5 });
    port.sessions.set("future", { startsAt: "2026-08-23T13:00:00Z", state: "UPCOMING", openMarkets: 4 });

    const service = new F1SessionLockService({ port, clock: clockAt("2026-08-02T13:00:00Z") });
    const summary = await service.run(50);

    expect(summary.outcome).toBe("SUCCESS");
    expect(summary.locked).toBe(2);
    expect(summary.marketsClosed).toBe(8);
    expect(port.sessions.get("quali")?.state).toBe("LOCKED");
    expect(port.sessions.get("race")?.state).toBe("LOCKED");
    expect(port.sessions.get("future")?.state).toBe("UPCOMING");
    expect(port.sessions.get("future")?.openMarkets).toBe(4);
  });

  it("is idempotent: a second sweep after success does nothing", async () => {
    const port = new FakeLockPort();
    port.sessions.set("quali", { startsAt: "2026-07-31T14:00:00Z", state: "UPCOMING", openMarkets: 3 });
    const service = new F1SessionLockService({ port, clock: clockAt("2026-07-31T14:00:01Z") });

    const first = await service.run(50);
    const second = await service.run(50);

    expect(first.locked).toBe(1);
    expect(second).toMatchObject({ outcome: "SUCCESS", locked: 0, marketsClosed: 0, skipped: 0 });
    expect(port.lockCalls).toEqual(["quali"]);
  });

  it("recovers after a restart: sessions that became due during downtime lock on the first sweep", async () => {
    const port = new FakeLockPort();
    port.sessions.set("missed-during-downtime", { startsAt: "2026-07-31T14:00:00Z", state: "UPCOMING", openMarkets: 2 });

    // First process: sweep runs before the session is due, then the process dies.
    const beforeRestart = new F1SessionLockService({ port, clock: clockAt("2026-07-31T13:00:00Z") });
    expect((await beforeRestart.run(50)).locked).toBe(0);
    expect(port.sessions.get("missed-during-downtime")?.state).toBe("UPCOMING");

    // Second process boots hours later with no carried-over memory.
    const afterRestart = new F1SessionLockService({ port, clock: clockAt("2026-07-31T18:00:00Z") });
    const summary = await afterRestart.run(50);
    expect(summary.locked).toBe(1);
    expect(port.sessions.get("missed-during-downtime")?.state).toBe("LOCKED");
  });

  it("treats sessions grabbed by a concurrent actor between list and lock as skipped", async () => {
    const port = new FakeLockPort();
    port.sessions.set("busy", { startsAt: "2026-07-31T14:00:00Z", state: "UPCOMING", openMarkets: 2, busy: true });
    const service = new F1SessionLockService({ port, clock: clockAt("2026-07-31T15:00:00Z") });

    const summary = await service.run(50);
    expect(summary).toMatchObject({ outcome: "SUCCESS", locked: 0, skipped: 1, failedSessionIds: [] });
    expect(port.sessions.get("busy")?.state).toBe("UPCOMING");
  });

  it("a failure on one session does not block the others and requests a retry", async () => {
    const port = new FakeLockPort();
    port.sessions.set("a-fails", { startsAt: "2026-07-31T13:00:00Z", state: "UPCOMING", openMarkets: 1 });
    port.sessions.set("b-locks", { startsAt: "2026-07-31T14:00:00Z", state: "UPCOMING", openMarkets: 2 });
    port.failWith = { sessionId: "a-fails", error: new Error("connection reset") };
    const service = new F1SessionLockService({ port, clock: clockAt("2026-07-31T15:00:00Z") });

    const summary = await service.run(50);
    expect(summary.outcome).toBe("RETRY");
    expect(summary.failedSessionIds).toEqual(["a-fails"]);
    expect(summary.locked).toBe(1);
    expect(port.sessions.get("b-locks")?.state).toBe("LOCKED");

    // The failed session is retried on the next sweep once the port recovers.
    port.failWith = undefined;
    const retried = await service.run(50);
    expect(retried.locked).toBe(1);
    expect(port.sessions.get("a-fails")?.state).toBe("LOCKED");
  });

  it("respects the batch limit", async () => {
    const port = new FakeLockPort();
    for (let index = 0; index < 5; index += 1) {
      port.sessions.set(`s${index}`, { startsAt: `2026-07-31T0${index}:00:00Z`, state: "UPCOMING", openMarkets: 1 });
    }
    const service = new F1SessionLockService({ port, clock: clockAt("2026-07-31T12:00:00Z") });

    const summary = await service.run(2);
    expect(summary.locked).toBe(2);
    expect(port.lockCalls).toEqual(["s0", "s1"]);
  });
});
