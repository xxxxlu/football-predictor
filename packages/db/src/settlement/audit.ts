import type postgres from "postgres";
import {
  buildDoubleSpendAuditReport,
  type DoubleSpendAuditReport,
  type LedgerDiscrepancy,
} from "@pulse/domain";

export interface SettlementAuditPort {
  runAudit(): Promise<DoubleSpendAuditReport>;
}

export class PostgresSettlementAuditRepository implements SettlementAuditPort {
  constructor(private readonly sql: postgres.Sql) {}

  async runAudit(): Promise<DoubleSpendAuditReport> {
    const discrepancies: LedgerDiscrepancy[] = [];
    const now = new Date().toISOString();

    // 1. Total counts
    const [counts] = await this.sql<Array<{ ticketCount: string; settlementCount: string; accountCount: string }>>`
      SELECT
        (SELECT COUNT(*) FROM prediction.tickets) AS "ticketCount",
        (SELECT COUNT(*) FROM prediction.settlements) AS "settlementCount",
        (SELECT COUNT(*) FROM ledger.point_accounts) AS "accountCount"
    `;

    const totalTicketsChecked = Number(counts?.ticketCount ?? 0);
    const totalSettlementsChecked = Number(counts?.settlementCount ?? 0);
    const totalAccountsAudited = Number(counts?.accountCount ?? 0);

    // 2. Check for multiple active settlements per ticket
    const multipleActive = await this.sql<Array<{ ticketId: string; count: string }>>`
      SELECT ticket_id AS "ticketId", COUNT(*) AS count
      FROM prediction.settlements
      WHERE status = 'ACTIVE'
      GROUP BY ticket_id
      HAVING COUNT(*) > 1
    `;

    for (const row of multipleActive) {
      discrepancies.push({
        id: `audit-mult-active-${row.ticketId}`,
        kind: "MULTIPLE_ACTIVE_SETTLEMENTS",
        severity: "CRITICAL",
        details: `Ticket ${row.ticketId} has ${row.count} active settlements (must be at most 1). Potential double-settlement hazard.`,
        ticketId: row.ticketId,
        expected: 1,
        actual: Number(row.count),
        detectedAt: now,
      });
    }

    // 3. Check for ticket vs active settlement link mismatch
    const invalidLinks = await this.sql<Array<{ ticketId: string; ticketStatus: string; activeSettlementId: string | null; settlementStatus: string | null }>>`
      SELECT
        t.id AS "ticketId",
        t.status AS "ticketStatus",
        t.active_settlement_id AS "activeSettlementId",
        s.status AS "settlementStatus"
      FROM prediction.tickets t
      LEFT JOIN prediction.settlements s ON s.id = t.active_settlement_id
      WHERE (t.status = 'SETTLED' AND (s.id IS NULL OR s.status <> 'ACTIVE'))
         OR (t.status = 'PENDING' AND t.active_settlement_id IS NOT NULL)
    `;

    for (const row of invalidLinks) {
      discrepancies.push({
        id: `audit-link-${row.ticketId}`,
        kind: "INVALID_TICKET_SETTLEMENT_LINK",
        severity: "CRITICAL",
        details: `Ticket ${row.ticketId} status is '${row.ticketStatus}' but active settlement status is '${row.settlementStatus ?? "NONE"}'.`,
        ticketId: row.ticketId,
        expected: row.ticketStatus === "SETTLED" ? "ACTIVE" : "NONE",
        actual: row.settlementStatus ?? "NONE",
        detectedAt: now,
      });
    }

    // 4. Invariant check: point_accounts balance matches sum of ledger entries
    const balanceViolations = await this.sql<Array<{
      roomId: string;
      userId: string;
      availablePoints: string;
      frozenPoints: string;
      correctionDebt: string;
      sumAvailableDelta: string;
      sumFrozenDelta: string;
      sumDebtDelta: string;
    }>>`
      SELECT
        a.room_id AS "roomId",
        a.user_id AS "userId",
        a.available_points AS "availablePoints",
        a.frozen_points AS "frozenPoints",
        a.correction_debt AS "correctionDebt",
        COALESCE(SUM(e.available_delta_points), 0) AS "sumAvailableDelta",
        COALESCE(SUM(e.frozen_delta_points), 0) AS "sumFrozenDelta",
        COALESCE(SUM(e.correction_debt_delta_points), 0) AS "sumDebtDelta"
      FROM ledger.point_accounts a
      LEFT JOIN ledger.entries e ON e.room_id = a.room_id AND e.user_id = a.user_id
      GROUP BY a.room_id, a.user_id, a.available_points, a.frozen_points, a.correction_debt
      HAVING a.available_points <> COALESCE(SUM(e.available_delta_points), 0)
          OR a.frozen_points <> COALESCE(SUM(e.frozen_delta_points), 0)
          OR a.correction_debt <> COALESCE(SUM(e.correction_debt_delta_points), 0)
    `;

    for (const row of balanceViolations) {
      discrepancies.push({
        id: `audit-bal-${row.roomId}-${row.userId}`,
        kind: "BALANCE_INTEGRITY_VIOLATION",
        severity: "CRITICAL",
        details: `Account balance desync for user ${row.userId} in room ${row.roomId}: available [account=${row.availablePoints}, ledgerSum=${row.sumAvailableDelta}], frozen [account=${row.frozenPoints}, ledgerSum=${row.sumFrozenDelta}], debt [account=${row.correctionDebt}, ledgerSum=${row.sumDebtDelta}].`,
        userId: row.userId,
        roomId: row.roomId,
        expected: Number(row.sumAvailableDelta),
        actual: Number(row.availablePoints),
        detectedAt: now,
      });
    }

    // 5. Check for dangling reversals
    const danglingReversals = await this.sql<Array<{ id: string; ticketId: string | null; reversesLedgerId: string | null }>>`
      SELECT
        e.id,
        e.ticket_id AS "ticketId",
        e.reverses_ledger_id AS "reversesLedgerId"
      FROM ledger.entries e
      WHERE e.kind = 'SETTLEMENT_REVERSAL'
        AND (
          e.reverses_ledger_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM ledger.entries orig WHERE orig.id = e.reverses_ledger_id
          )
        )
    `;

    for (const row of danglingReversals) {
      discrepancies.push({
        id: `audit-dangling-rev-${row.id}`,
        kind: "DANGLING_REVERSAL",
        severity: "CRITICAL",
        details: `Settlement reversal ledger entry ${row.id} references non-existent ledger entry ${row.reversesLedgerId ?? "NULL"}.`,
        ...(row.ticketId ? { ticketId: row.ticketId } : {}),
        detectedAt: now,
      });
    }

    // 6. Check for active settlements missing corresponding SETTLE operation receipt
    const missingOperations = await this.sql<Array<{ ticketId: string; settlementVersion: string }>>`
      SELECT
        s.ticket_id AS "ticketId",
        s.settlement_version AS "settlementVersion"
      FROM prediction.settlements s
      WHERE s.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1 FROM prediction.settlement_operations op
          WHERE op.ticket_id = s.ticket_id
            AND op.settlement_version = s.settlement_version
            AND op.operation = 'SETTLE'
        )
    `;

    for (const row of missingOperations) {
      discrepancies.push({
        id: `audit-missing-op-${row.ticketId}-${row.settlementVersion}`,
        kind: "UNMATCHED_SETTLEMENT_OPERATION",
        severity: "WARNING",
        details: `Active settlement on ticket ${row.ticketId} (version ${row.settlementVersion}) has no matching SETTLE operation record in prediction.settlement_operations.`,
        ticketId: row.ticketId,
        detectedAt: now,
      });
    }

    return buildDoubleSpendAuditReport({
      generatedAt: now,
      totalTicketsChecked,
      totalSettlementsChecked,
      totalAccountsAudited,
      discrepancies,
    });
  }
}
