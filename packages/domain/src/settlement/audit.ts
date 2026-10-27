export type LedgerDiscrepancyKind =
  | "MULTIPLE_ACTIVE_SETTLEMENTS"
  | "ORPHANED_SETTLEMENT"
  | "INVALID_TICKET_SETTLEMENT_LINK"
  | "BALANCE_INTEGRITY_VIOLATION"
  | "UNMATCHED_SETTLEMENT_OPERATION"
  | "DANGLING_REVERSAL";

export interface LedgerDiscrepancy {
  id: string;
  kind: LedgerDiscrepancyKind;
  severity: "CRITICAL" | "WARNING";
  details: string;
  ticketId?: string;
  userId?: string;
  roomId?: string;
  expected?: number | string;
  actual?: number | string;
  detectedAt: string;
}

export interface DoubleSpendAuditReport {
  generatedAt: string;
  passed: boolean;
  totalTicketsChecked: number;
  totalSettlementsChecked: number;
  totalAccountsAudited: number;
  discrepancies: LedgerDiscrepancy[];
  summary: {
    criticalCount: number;
    warningCount: number;
    cleanAccountCount: number;
    corruptedAccountCount: number;
  };
}

export function buildDoubleSpendAuditReport(input: {
  generatedAt?: string;
  totalTicketsChecked: number;
  totalSettlementsChecked: number;
  totalAccountsAudited: number;
  discrepancies: LedgerDiscrepancy[];
}): DoubleSpendAuditReport {
  const criticalCount = input.discrepancies.filter((d) => d.severity === "CRITICAL").length;
  const warningCount = input.discrepancies.filter((d) => d.severity === "WARNING").length;
  const corruptedAccountIds = new Set(
    input.discrepancies
      .filter((d) => d.kind === "BALANCE_INTEGRITY_VIOLATION" && d.userId)
      .map((d) => `${d.roomId ?? ""}:${d.userId}`),
  );
  const corruptedAccountCount = corruptedAccountIds.size;
  const cleanAccountCount = Math.max(0, input.totalAccountsAudited - corruptedAccountCount);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    passed: criticalCount === 0 && input.discrepancies.length === 0,
    totalTicketsChecked: input.totalTicketsChecked,
    totalSettlementsChecked: input.totalSettlementsChecked,
    totalAccountsAudited: input.totalAccountsAudited,
    discrepancies: input.discrepancies,
    summary: {
      criticalCount,
      warningCount,
      cleanAccountCount,
      corruptedAccountCount,
    },
  };
}
