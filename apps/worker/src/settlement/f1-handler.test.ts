import { describe, expect, it } from "vitest";
import type { F1SettlementCandidate } from "@football-predictor/domain";
import { createF1SettlementJobHandler } from "./f1-handler.js";
import { createSettlementWorkerComposition } from "./composition.js";

const classification = [
  { driverCode: "NOR", position: 1, status: "FINISHED" as const, lapsCompleted: 52 },
  { driverCode: "VER", position: 2, status: "FINISHED" as const, lapsCompleted: 52 },
  { driverCode: "STR", position: null, status: "DNS" as const, lapsCompleted: 0 },
];

const candidate = (overrides: Partial<F1SettlementCandidate> = {}): F1SettlementCandidate => ({
  ticketId: "f1-ticket-1", settlementVersion: "1", activeSettlementVersion: null,
  sessionState: "FINISHED", resultConfirmed: true, classification, selection: "DRV:NOR", supplierMarketId: 102,
  ...overrides,
});

describe("F1 settlement worker", () => {
  it("settles a confirmed winner ticket as FINAL/WIN", async () => {
    const calls: unknown[] = [];
    const handler = createF1SettlementJobHandler({
      candidates: { scan: async () => [candidate()], get: async () => candidate() },
      settlement: { settle: async (input) => { calls.push(input); return { status: "SETTLED" }; }, correct: async () => ({ status: "SETTLED" }) },
    });
    await expect(handler.scan({ limit: 20 })).resolves.toEqual({ outcome: "SUCCESS", processed: 1, held: 0, failedTicketIds: [] });
    expect(calls[0]).toMatchObject({ ticketId: "f1-ticket-1", settlementVersion: "1", matchStatus: "FINAL", outcome: "WIN" });
  });

  it("routes DNS refunds and session voids through CANCELLED with no outcome", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const dns = candidate({ selection: "DRV:STR" });
    const voided = candidate({ ticketId: "f1-ticket-2", sessionState: "CANCELLED", classification: null, settlementVersion: "2" });
    const handler = createF1SettlementJobHandler({
      candidates: { scan: async () => [dns, voided], get: async () => null },
      settlement: { settle: async (input) => { calls.push(input as Record<string, unknown>); return { status: "SETTLED" }; }, correct: async () => ({ status: "SETTLED" }) },
    });
    await handler.scan({ limit: 20 });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.matchStatus).toBe("CANCELLED");
      expect(call).not.toHaveProperty("outcome");
    }
  });

  it("corrects an already-settled ticket when the confirmed version changes", async () => {
    const calls: unknown[] = [];
    const changed = candidate({ activeSettlementVersion: "1", settlementVersion: "2", selection: "DRV:VER" });
    const handler = createF1SettlementJobHandler({
      candidates: { scan: async () => [changed], get: async () => changed },
      settlement: { settle: async () => ({ status: "SETTLED" }), correct: async (input) => { calls.push(input); return { status: "SETTLED" }; } },
    });
    await handler.scan({ limit: 20 });
    expect(calls[0]).toMatchObject({ previousSettlementVersion: "1", settlementVersion: "2", outcome: "LOSS" });
  });

  it("holds unconfirmed or already-current tickets and retries per-ticket failures", async () => {
    const unconfirmed = candidate({ ticketId: "held-1", resultConfirmed: false });
    const current = candidate({ ticketId: "held-2", activeSettlementVersion: "1" });
    const malformed = candidate({ ticketId: "fail-1", selection: "HOME" });
    const handler = createF1SettlementJobHandler({
      candidates: { scan: async () => [unconfirmed, current, malformed], get: async () => malformed },
      settlement: { settle: async () => ({ status: "SETTLED" }), correct: async () => ({ status: "SETTLED" }) },
    });
    await expect(handler.scan({ limit: 20 })).resolves.toEqual({ outcome: "RETRY", processed: 0, held: 2, failedTicketIds: ["fail-1"] });
    await expect(handler.retry("fail-1")).resolves.toEqual({ outcome: "RETRY", ticketId: "fail-1" });
  });

  it("merges football and F1 scans in the composition and falls back on retry", async () => {
    const composition = createSettlementWorkerComposition({
      candidates: { scan: async () => [], get: async () => null },
      f1Candidates: { scan: async () => [candidate()], get: async () => candidate() },
      settlement: { settle: async () => ({ status: "SETTLED" }), correct: async () => ({ status: "SETTLED" }) },
      close: async () => {},
    });
    await expect(composition.scan(20)).resolves.toEqual({ outcome: "SUCCESS", processed: 1, held: 0, failedTicketIds: [] });
    await expect(composition.retry("f1-ticket-1")).resolves.toEqual({ outcome: "SUCCESS", ticketId: "f1-ticket-1" });
  });
});
