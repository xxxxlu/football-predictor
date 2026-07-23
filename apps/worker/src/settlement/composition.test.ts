import { describe, expect, it } from "vitest";
import { createSettlementWorkerComposition } from "./composition.js";

describe("settlement composition", () => {
  it("exposes scan, manual retry and idempotent close", async () => {
    let closes = 0;
    const composition = createSettlementWorkerComposition({
      candidates: { scan: async () => [], get: async () => null },
      settlement: { settle: async () => ({ status: "SETTLED" }), correct: async () => ({ status: "SETTLED" }) },
      close: async () => { closes += 1; },
    });
    await expect(composition.scan(20)).resolves.toEqual({ outcome: "SUCCESS", processed: 0, held: 0, failedTicketIds: [] });
    await expect(composition.retry("missing")).resolves.toEqual({ outcome: "NOT_FOUND", ticketId: "missing" });
    await composition.close();
    await composition.close();
    expect(closes).toBe(1);
  });

  it("sweeps F1 session locks through the domain service when the port is wired", async () => {
    const locked: string[] = [];
    const composition = createSettlementWorkerComposition({
      candidates: { scan: async () => [], get: async () => null },
      settlement: { settle: async () => ({ status: "SETTLED" }), correct: async () => ({ status: "SETTLED" }) },
      clock: { now: () => new Date("2026-07-31T14:00:01Z") },
      f1SessionLocks: {
        listDueSessions: async () => [{ id: "quali", startsAt: "2026-07-31T14:00:00Z" }],
        lockSession: async (sessionId) => { locked.push(sessionId); return { marketsClosed: 3 }; },
      },
      close: async () => undefined,
    });
    await expect(composition.lockDueF1Sessions(100)).resolves.toEqual({
      outcome: "SUCCESS", locked: 1, marketsClosed: 3, skipped: 0, failedSessionIds: [],
    });
    expect(locked).toEqual(["quali"]);
  });

  it("is a permanent no-op without an F1 lock port and rejects after close", async () => {
    const composition = createSettlementWorkerComposition({
      candidates: { scan: async () => [], get: async () => null },
      settlement: { settle: async () => ({ status: "SETTLED" }), correct: async () => ({ status: "SETTLED" }) },
      close: async () => undefined,
    });
    await expect(composition.lockDueF1Sessions(100)).resolves.toEqual({
      outcome: "SUCCESS", locked: 0, marketsClosed: 0, skipped: 0, failedSessionIds: [],
    });
    await composition.close();
    await expect(composition.lockDueF1Sessions(100)).rejects.toThrow("closed");
  });
});
