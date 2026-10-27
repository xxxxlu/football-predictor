import { describe, expect, it, vi } from "vitest";
import { PostgresSettlementAuditRepository } from "./audit.js";

describe("PostgresSettlementAuditRepository", () => {
  it("runs full audit and returns clean report when no anomalies are found", async () => {
    const mockSql = vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("COUNT(*) FROM prediction.tickets")) {
        return [{ ticketCount: "100", settlementCount: "80", accountCount: "30" }];
      }
      if (query.includes("COUNT(*) > 1")) {
        return []; // no multiple active settlements
      }
      if (query.includes("active_settlement_id")) {
        return []; // no invalid ticket links
      }
      if (query.includes("sumAvailableDelta")) {
        return []; // no balance violations
      }
      if (query.includes("danglingReversals") || query.includes("reverses_ledger_id")) {
        return []; // no dangling reversals
      }
      if (query.includes("settlement_operations")) {
        return []; // no missing operations
      }
      return [];
    });

    const repo = new PostgresSettlementAuditRepository(mockSql as any);
    const report = await repo.runAudit();

    expect(report.passed).toBe(true);
    expect(report.totalTicketsChecked).toBe(100);
    expect(report.totalSettlementsChecked).toBe(80);
    expect(report.totalAccountsAudited).toBe(30);
    expect(report.discrepancies).toHaveLength(0);
    expect(report.summary.criticalCount).toBe(0);
  });

  it("detects multiple active settlements, balance desync, and missing operations", async () => {
    const mockSql = vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("COUNT(*) FROM prediction.tickets")) {
        return [{ ticketCount: "50", settlementCount: "60", accountCount: "20" }];
      }
      if (query.includes("COUNT(*) > 1")) {
        return [{ ticketId: "ticket-double", count: "2" }];
      }
      if (query.includes("active_settlement_id")) {
        return [{ ticketId: "ticket-link-err", ticketStatus: "SETTLED", activeSettlementId: null, settlementStatus: null }];
      }
      if (query.includes("sumAvailableDelta")) {
        return [{
          roomId: "room-1",
          userId: "user-1",
          availablePoints: "1000",
          frozenPoints: "0",
          correctionDebt: "0",
          sumAvailableDelta: "800",
          sumFrozenDelta: "0",
          sumDebtDelta: "0",
        }];
      }
      if (query.includes("reverses_ledger_id")) {
        return [{ id: "rev-1", ticketId: "ticket-rev", reversesLedgerId: "missing-orig" }];
      }
      if (query.includes("settlement_operations")) {
        return [{ ticketId: "ticket-op-err", settlementVersion: "v1" }];
      }
      return [];
    });

    const repo = new PostgresSettlementAuditRepository(mockSql as any);
    const report = await repo.runAudit();

    expect(report.passed).toBe(false);
    expect(report.summary.criticalCount).toBe(4);
    expect(report.summary.warningCount).toBe(1);
    expect(report.discrepancies).toHaveLength(5);

    const kinds = report.discrepancies.map((d) => d.kind);
    expect(kinds).toContain("MULTIPLE_ACTIVE_SETTLEMENTS");
    expect(kinds).toContain("INVALID_TICKET_SETTLEMENT_LINK");
    expect(kinds).toContain("BALANCE_INTEGRITY_VIOLATION");
    expect(kinds).toContain("DANGLING_REVERSAL");
    expect(kinds).toContain("UNMATCHED_SETTLEMENT_OPERATION");
  });
});
