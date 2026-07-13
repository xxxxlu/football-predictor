import { describe, expect, it } from "vitest";
import { correctionDebtExplanation, historySettlementFacts, ledgerReferenceFacts } from "./ledger-presentation";

describe("operations presentation", () => {
  it("shows the settlement facts needed to reconcile a ticket", () => {
    expect(historySettlementFacts({ outcome: "WIN", returnPoints: "2100.00", netPoints: "+1100.00", settlementVersion: "result-v3" })).toEqual([
      { label: "赛果", value: "命中" },
      { label: "返还", value: "2100.00" },
      { label: "净变化", value: "+1100.00" },
      { label: "结算版本", value: "result-v3" },
    ]);
  });

  it("explains correction debt and exposes ledger trace identifiers", () => {
    expect(correctionDebtExplanation("1900.00")).toContain("不是现金欠款");
    expect(correctionDebtExplanation("1900.00")).toContain("后续结算返还");
    expect(ledgerReferenceFacts({ roomId: "room-1", ticketId: "ticket-1", settlementVersion: "result-v2", auditId: "audit-1", reversesLedgerId: "ledger-0" })).toEqual([
      ["房间", "room-1"], ["票号", "ticket-1"], ["结算版本", "result-v2"], ["审计号", "audit-1"], ["冲正记录", "ledger-0"],
    ]);
  });
});
