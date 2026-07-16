import { describe, expect, it } from "vitest";
import { mapSettlementCandidateRow } from "./repository.js";

describe("settlement PostgreSQL candidate adapter", () => {
  it("maps confirmed supplier result and active version without numeric coercion drift", () => {
    expect(mapSettlementCandidateRow({
      ticketId: "ticket-1", settlementVersion: "result-v2", activeSettlementVersion: "result-v1",
      matchStatus: "FINISHED", resultConfirmed: true, homeScore: 2, awayScore: 1, selection: "HOME", supplierMarketId: 1,
    })).toEqual({
      ticketId: "ticket-1", settlementVersion: "result-v2", activeSettlementVersion: "result-v1",
      matchStatus: "FINISHED", resultConfirmed: true, homeScore: 2, awayScore: 1, selection: "HOME", supplierMarketId: 1,
    });
  });
});
