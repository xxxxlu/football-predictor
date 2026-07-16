import type postgres from "postgres";
import {
  SettlementError,
  type ReversalWrite,
  type SettlementOperationReceipt,
  type SettlementRecord,
  type SettlementScope,
  type SettlementState,
  type SettlementTransaction,
  type SettlementTransactionPort,
  type SettlementWrite,
} from "@football-predictor/domain";

export interface SettlementCandidateRecord {
  ticketId: string;
  settlementVersion: string;
  activeSettlementVersion: string | null;
  matchStatus: "FINISHED" | "CANCELLED" | "POSTPONED" | "SUSPENDED" | "SCHEDULED" | "LIVE";
  resultConfirmed: boolean;
  homeScore: number | null;
  awayScore: number | null;
  selection: string;
  supplierMarketId: number;
}

export function mapSettlementCandidateRow(row: SettlementCandidateRecord): SettlementCandidateRecord {
  return { ...row, supplierMarketId: Number(row.supplierMarketId) };
}

type StateRow = {
  ticketId: string; userId: string; roomId: string; stakePoints: string; decimalOdds: string;
  availablePoints: string; frozenPoints: string; correctionDebtPoints: string;
  settlementId: string | null; settlementVersion: string | null; outcome: SettlementRecord["outcome"] | null;
  grossReturnPoints: string | null; availableDeltaPoints: string | null; frozenDeltaPoints: string | null;
  correctionDebtDeltaPoints: string | null; ledgerId: string | null; settledAt: Date | null;
};

function integer(value: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error("Point value is outside safe integer range");
  return result;
}

function mapState(row: StateRow): SettlementState {
  const activeSettlement = row.settlementId === null ? null : {
    id: row.settlementId,
    ticketId: row.ticketId,
    settlementVersion: row.settlementVersion!,
    outcome: row.outcome!,
    grossReturnPoints: integer(row.grossReturnPoints!),
    availableDeltaPoints: integer(row.availableDeltaPoints!),
    frozenDeltaPoints: integer(row.frozenDeltaPoints!),
    correctionDebtDeltaPoints: integer(row.correctionDebtDeltaPoints!),
    ledgerId: row.ledgerId!,
    settledAt: row.settledAt!.toISOString(),
  };
  return {
    ticket: { id: row.ticketId, userId: row.userId, roomId: row.roomId, stakePoints: integer(row.stakePoints), decimalOdds: row.decimalOdds },
    account: { availablePoints: integer(row.availablePoints), frozenPoints: integer(row.frozenPoints), correctionDebtPoints: integer(row.correctionDebtPoints) },
    activeSettlement,
  };
}

export class PostgresSettlementTransactionPort implements SettlementTransactionPort {
  constructor(private readonly sql: postgres.Sql) {}

  async run<T>(scope: SettlementScope, work: (transaction: SettlementTransaction) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => {
      const locked = await tx`SELECT id FROM prediction.tickets WHERE id=${scope.ticketId} FOR UPDATE`;
      if (locked.length === 0) throw new SettlementError("TICKET_NOT_FOUND");
      const transaction: SettlementTransaction = {
        findOperation: async (key) => {
          const [row] = await tx<Array<{ receipt: SettlementOperationReceipt }>>`SELECT receipt FROM prediction.settlement_operations
            WHERE ticket_id=${key.ticketId} AND settlement_version=${key.settlementVersion} AND operation=${key.operation} LIMIT 1`;
          return row?.receipt ?? null;
        },
        getState: async (ticketId) => {
          const [row] = await tx<StateRow[]>`SELECT t.id AS "ticketId",t.user_id AS "userId",t.room_id AS "roomId",t.stake_points AS "stakePoints",
            l.decimal_odds AS "decimalOdds",a.available_points AS "availablePoints",a.frozen_points AS "frozenPoints",a.correction_debt AS "correctionDebtPoints",
            s.id AS "settlementId",s.settlement_version AS "settlementVersion",s.outcome,s.gross_return_points AS "grossReturnPoints",
            s.available_delta_points AS "availableDeltaPoints",s.frozen_delta_points AS "frozenDeltaPoints",
            s.correction_debt_delta_points AS "correctionDebtDeltaPoints",s.ledger_id AS "ledgerId",s.settled_at AS "settledAt"
            FROM prediction.tickets t JOIN prediction.legs l ON l.ticket_id=t.id AND l.leg_number=1
            JOIN ledger.point_accounts a ON a.room_id=t.room_id AND a.user_id=t.user_id
            LEFT JOIN prediction.settlements s ON s.id=t.active_settlement_id WHERE t.id=${ticketId} LIMIT 1`;
          return row ? mapState(row) : null;
        },
        persistSettlement: (write) => this.persistSettlement(tx, write),
        persistReversal: (write) => this.persistReversal(tx, write),
      };
      return work(transaction);
    }) as Promise<T>;
  }

  private async persistSettlement(tx: postgres.TransactionSql, write: SettlementWrite): Promise<SettlementOperationReceipt> {
    const [ticket] = await tx<Array<{ roomId: string; userId: string; stakePoints: string }>>`SELECT room_id AS "roomId",user_id AS "userId",stake_points AS "stakePoints"
      FROM prediction.tickets WHERE id=${write.scope.ticketId} AND active_settlement_id IS NULL LIMIT 1`;
    if (!ticket) throw new SettlementError("SETTLEMENT_CONFLICT");
    const updated = await tx`UPDATE ledger.point_accounts SET available_points=available_points+${write.balance.availableDeltaPoints},
      frozen_points=frozen_points+${write.balance.frozenDeltaPoints},correction_debt=correction_debt+${write.balance.correctionDebtDeltaPoints},updated_at=${new Date(write.record.settledAt)}
      WHERE room_id=${ticket.roomId} AND user_id=${ticket.userId} AND frozen_points >= ${-write.balance.frozenDeltaPoints}
        AND correction_debt+${write.balance.correctionDebtDeltaPoints} >= 0 RETURNING user_id`;
    if (updated.length === 0) throw new SettlementError("INSUFFICIENT_FROZEN");
    await tx`INSERT INTO prediction.settlements
      (id,ticket_id,settlement_version,outcome,gross_return_points,available_delta_points,frozen_delta_points,correction_debt_delta_points,ledger_id,status,settled_at)
      VALUES (${write.record.id},${write.record.ticketId},${write.record.settlementVersion},${write.record.outcome},${write.record.grossReturnPoints},${write.record.availableDeltaPoints},${write.record.frozenDeltaPoints},${write.record.correctionDebtDeltaPoints},${write.record.ledgerId},'ACTIVE',${new Date(write.record.settledAt)})`;
    await tx`INSERT INTO ledger.entries
      (id,room_id,user_id,kind,amount,idempotency_key,audit_id,created_at,available_delta_points,frozen_delta_points,ticket_id,correction_debt_delta_points,settlement_version,reverses_ledger_id)
      VALUES (${write.ledger.id},${ticket.roomId},${ticket.userId},${write.ledger.type},${write.record.grossReturnPoints},${`settle:${write.scope.ticketId}:${write.scope.settlementVersion}`},${write.ledger.id},${new Date(write.ledger.occurredAt)},${write.ledger.availableDeltaPoints},${write.ledger.frozenDeltaPoints},${write.scope.ticketId},${write.ledger.correctionDebtDeltaPoints},${write.scope.settlementVersion},null)`;
    await tx`UPDATE prediction.tickets SET status='SETTLED',active_settlement_id=${write.record.id} WHERE id=${write.scope.ticketId}`;
    await tx`INSERT INTO prediction.settlement_operations (ticket_id,settlement_version,operation,receipt,created_at)
      VALUES (${write.scope.ticketId},${write.scope.settlementVersion},'SETTLE',CAST(${JSON.stringify(write.receipt)} AS jsonb),${new Date(write.record.settledAt)})`;
    return write.receipt;
  }

  private async persistReversal(tx: postgres.TransactionSql, write: ReversalWrite): Promise<SettlementOperationReceipt> {
    const [ticket] = await tx<Array<{ roomId: string; userId: string; activeSettlementId: string }>>`SELECT room_id AS "roomId",user_id AS "userId",active_settlement_id AS "activeSettlementId"
      FROM prediction.tickets WHERE id=${write.scope.ticketId} AND active_settlement_id IS NOT NULL LIMIT 1`;
    if (!ticket) throw new SettlementError("SETTLEMENT_CONFLICT");
    const reversed = await tx`UPDATE prediction.settlements SET status='REVERSED',reversed_at=${new Date(write.receipt.reversedAt)}
      WHERE id=${ticket.activeSettlementId} AND ticket_id=${write.scope.ticketId} AND settlement_version=${write.scope.settlementVersion} AND status='ACTIVE' RETURNING id`;
    if (reversed.length === 0) throw new SettlementError("SETTLEMENT_CONFLICT");
    const updated = await tx`UPDATE ledger.point_accounts SET available_points=available_points+${write.balance.availableDeltaPoints},
      frozen_points=frozen_points+${write.balance.frozenDeltaPoints},correction_debt=correction_debt+${write.balance.correctionDebtDeltaPoints},updated_at=${new Date(write.receipt.reversedAt)}
      WHERE room_id=${ticket.roomId} AND user_id=${ticket.userId} AND available_points+${write.balance.availableDeltaPoints} >= 0
        AND correction_debt+${write.balance.correctionDebtDeltaPoints} >= 0 RETURNING user_id`;
    if (updated.length === 0) throw new SettlementError("SETTLEMENT_CONFLICT");
    await tx`INSERT INTO ledger.entries
      (id,room_id,user_id,kind,amount,idempotency_key,audit_id,created_at,available_delta_points,frozen_delta_points,ticket_id,correction_debt_delta_points,settlement_version,reverses_ledger_id)
      VALUES (${write.ledger.id},${ticket.roomId},${ticket.userId},${write.ledger.type},0,${`reverse:${write.scope.ticketId}:${write.scope.settlementVersion}`},${write.ledger.id},${new Date(write.ledger.occurredAt)},${write.ledger.availableDeltaPoints},${write.ledger.frozenDeltaPoints},${write.scope.ticketId},${write.ledger.correctionDebtDeltaPoints},${write.scope.settlementVersion},${write.ledger.reversesLedgerId})`;
    await tx`UPDATE prediction.tickets SET status='PENDING',active_settlement_id=null WHERE id=${write.scope.ticketId}`;
    await tx`INSERT INTO prediction.settlement_operations (ticket_id,settlement_version,operation,receipt,created_at)
      VALUES (${write.scope.ticketId},${write.scope.settlementVersion},'REVERSAL',CAST(${JSON.stringify(write.receipt)} AS jsonb),${new Date(write.receipt.reversedAt)})`;
    return write.receipt;
  }
}

type CandidateRow = SettlementCandidateRecord;

export class PostgresSettlementCandidateRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async scan(limit: number): Promise<SettlementCandidateRecord[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = await this.sql<CandidateRow[]>`SELECT t.id AS "ticketId",f.result_version AS "settlementVersion",s.settlement_version AS "activeSettlementVersion",
      f.status AS "matchStatus",f.result_confirmed AS "resultConfirmed",f.home_score AS "homeScore",f.away_score AS "awayScore",l.selection,l.supplier_market_id AS "supplierMarketId"
      FROM prediction.tickets t JOIN prediction.legs l ON l.ticket_id=t.id AND l.leg_number=1
      JOIN supplier.fixtures f ON f.id=t.fixture_id LEFT JOIN prediction.settlements s ON s.id=t.active_settlement_id
      WHERE f.result_confirmed=true AND f.result_version IS NOT NULL AND f.status IN ('FINISHED','CANCELLED')
        AND (t.active_settlement_id IS NULL OR s.settlement_version<>f.result_version)
      ORDER BY f.updated_at,t.created_at LIMIT ${safeLimit}`;
    return rows.map(mapSettlementCandidateRow);
  }

  async get(ticketId: string): Promise<SettlementCandidateRecord | null> {
    const [row] = await this.sql<CandidateRow[]>`SELECT t.id AS "ticketId",f.result_version AS "settlementVersion",s.settlement_version AS "activeSettlementVersion",
      f.status AS "matchStatus",f.result_confirmed AS "resultConfirmed",f.home_score AS "homeScore",f.away_score AS "awayScore",l.selection,l.supplier_market_id AS "supplierMarketId"
      FROM prediction.tickets t JOIN prediction.legs l ON l.ticket_id=t.id AND l.leg_number=1
      JOIN supplier.fixtures f ON f.id=t.fixture_id LEFT JOIN prediction.settlements s ON s.id=t.active_settlement_id
      WHERE t.id=${ticketId} LIMIT 1`;
    return row ? mapSettlementCandidateRow(row) : null;
  }
}
