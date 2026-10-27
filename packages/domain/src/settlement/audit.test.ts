import { describe, expect, it } from "vitest";
import { buildDoubleSpendAuditReport, type LedgerDiscrepancy } from "./audit.js";

describe("buildDoubleSpendAuditReport", () => {
  it("generates a passing audit report when there are no discrepancies", () => {
    const report = buildDoubleSpendAuditReport({
      totalTicketsChecked: 150,
      totalSettlementsChecked: 120,
      totalAccountsAudited: 45,
      discrepancies: [],
    });

    expect(report.passed).toBe(true);
    expect(report.totalTicketsChecked).toBe(150);
    expect(report.summary.criticalCount).toBe(0);
    expect(report.summary.cleanAccountCount).toBe(45);
    expect(report.summary.corruptedAccountCount).toBe(0);
  });

  it("identifies corrupted accounts and marks report as failed when discrepancies exist", () => {
    const discrepancies: LedgerDiscrepancy[] = [
      {
        id: "disc-1",
        kind: "MULTIPLE_ACTIVE_SETTLEMENTS",
        severity: "CRITICAL",
        details: "Ticket has 2 active settlements",
        ticketId: "ticket-1",
        detectedAt: "2026-10-19T10:00:00.000Z",
      },
      {
        id: "disc-2",
        kind: "BALANCE_INTEGRITY_VIOLATION",
        severity: "CRITICAL",
        details: "Ledger sum mismatch for available points",
        userId: "user-99",
        roomId: "room-1",
        expected: 5000,
        actual: 4500,
        detectedAt: "2026-10-19T10:00:00.000Z",
      },
    ];

    const report = buildDoubleSpendAuditReport({
      totalTicketsChecked: 200,
      totalSettlementsChecked: 180,
      totalAccountsAudited: 50,
      discrepancies,
    });

    expect(report.passed).toBe(false);
    expect(report.summary.criticalCount).toBe(2);
    expect(report.summary.corruptedAccountCount).toBe(1);
    expect(report.summary.cleanAccountCount).toBe(49);
    expect(report.discrepancies).toHaveLength(2);
  });
});
