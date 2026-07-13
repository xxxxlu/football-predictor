import { describe, expect, it } from "vitest";
import { createSettlementJobHandler, createSettlementRetryService, outcomeForCandidate, type SettlementCandidate } from "./handler.js";

const candidate = (overrides: Partial<SettlementCandidate> = {}): SettlementCandidate => ({
  ticketId: "ticket-1", settlementVersion: "result-v1", activeSettlementVersion: null,
  matchStatus: "FINISHED", resultConfirmed: true, homeScore: 2, awayScore: 1, selection: "HOME", ...overrides,
});

describe("settlement worker", () => {
  it("derives 1X2 WIN/LOSS and cancellation without floating point", () => {
    expect(outcomeForCandidate(candidate())).toBe("WIN");
    expect(outcomeForCandidate(candidate({ selection: "DRAW" }))).toBe("LOSS");
    expect(outcomeForCandidate(candidate({ homeScore: 1, awayScore: 1, selection: "DRAW" }))).toBe("WIN");
    expect(outcomeForCandidate(candidate({ matchStatus: "CANCELLED", homeScore: null, awayScore: null }))).toBe("CANCEL");
  });

  it("scans and settles new confirmed tickets", async () => {
    const calls: unknown[] = [];
    const handler = createSettlementJobHandler({
      candidates: { scan: async () => [candidate()], get: async () => candidate() },
      settlement: { settle: async (input) => { calls.push(input); return { status: "SETTLED" }; }, correct: async () => ({ status: "SETTLED" }) },
    });
    await expect(handler.scan({ limit: 20 })).resolves.toEqual({ outcome: "SUCCESS", processed: 1, held: 0, failedTicketIds: [] });
    expect(calls[0]).toMatchObject({ ticketId: "ticket-1", settlementVersion: "result-v1", matchStatus: "FINAL", outcome: "WIN" });
  });

  it("corrects a changed result by passing previous version before the new settlement", async () => {
    const calls: unknown[] = [];
    const changed = candidate({ activeSettlementVersion: "result-v1", settlementVersion: "result-v2", homeScore: 0, awayScore: 1 });
    const handler = createSettlementJobHandler({
      candidates: { scan: async () => [changed], get: async () => changed },
      settlement: { settle: async () => ({ status: "SETTLED" }), correct: async (input) => { calls.push(input); return { status: "SETTLED" }; } },
    });
    await handler.scan({ limit: 20 });
    expect(calls[0]).toMatchObject({ previousSettlementVersion: "result-v1", settlementVersion: "result-v2", outcome: "LOSS" });
  });

  it("keeps unresolved matches held and reports retryable per-ticket failures", async () => {
    const unresolved = candidate({ ticketId: "ticket-held", resultConfirmed: false });
    const failing = candidate({ ticketId: "ticket-fail" });
    const handler = createSettlementJobHandler({
      candidates: { scan: async () => [unresolved, failing], get: async () => failing },
      settlement: { settle: async () => { throw new Error("db unavailable"); }, correct: async () => ({ status: "SETTLED" }) },
    });
    await expect(handler.scan({ limit: 20 })).resolves.toEqual({ outcome: "RETRY", processed: 0, held: 1, failedTicketIds: ["ticket-fail"] });
  });

  it("offers a minimal manual retry path for one ticket", async () => {
    let settled = 0;
    const retry = createSettlementRetryService({
      candidates: { scan: async () => [], get: async () => candidate() },
      settlement: { settle: async () => { settled += 1; return { status: "SETTLED" }; }, correct: async () => ({ status: "SETTLED" }) },
    });
    await expect(retry.retry("ticket-1")).resolves.toEqual({ outcome: "SUCCESS", ticketId: "ticket-1" });
    expect(settled).toBe(1);
  });
});
