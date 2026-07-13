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
});
