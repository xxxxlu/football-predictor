import type postgres from "postgres";
import type {
  F1ClassificationEntry,
  F1ResultEntryTransaction,
  F1ResultEntryTransactionPort,
  F1Session,
  F1SessionState,
  F1SettlementCandidate,
} from "@pulse/domain";

type CandidateRow = {
  ticketId: string;
  settlementVersion: string | number;
  activeSettlementVersion: string | null;
  sessionState: F1SessionState;
  resultConfirmed: boolean;
  classification: unknown;
  selection: string;
  supplierMarketId: string | number;
};

function mapCandidate(row: CandidateRow): F1SettlementCandidate {
  return {
    ticketId: row.ticketId,
    settlementVersion: String(row.settlementVersion),
    activeSettlementVersion: row.activeSettlementVersion,
    sessionState: row.sessionState,
    resultConfirmed: row.resultConfirmed,
    classification: parseClassification(row.classification),
    selection: row.selection,
    supplierMarketId: Number(row.supplierMarketId),
  };
}

function parseClassification(value: unknown): F1ClassificationEntry[] | null {
  const decoded = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(decoded) ? (decoded as F1ClassificationEntry[]) : null;
}

/** Scans F1 tickets whose session has a confirmed result version different from the
 *  ticket's active settlement version — the same eligibility rule as football. */
export class PostgresF1SettlementCandidateRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async scan(limit: number): Promise<F1SettlementCandidate[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = await this.sql<CandidateRow[]>`SELECT t.id AS "ticketId",s.result_version AS "settlementVersion",
      st.settlement_version AS "activeSettlementVersion",s.state AS "sessionState",s.result_confirmed AS "resultConfirmed",
      r.classification,l.selection,l.supplier_market_id AS "supplierMarketId"
      FROM prediction.tickets t JOIN prediction.legs l ON l.ticket_id=t.id AND l.leg_number=1
      JOIN f1.sessions s ON t.fixture_id = 'f1:' || s.id::text
      LEFT JOIN f1.session_results r ON r.session_id=s.id AND r.version=s.result_version
      LEFT JOIN prediction.settlements st ON st.id=t.active_settlement_id
      WHERE t.fixture_id LIKE 'f1:%' AND s.result_confirmed=true AND s.result_version IS NOT NULL
        AND s.state IN ('FINISHED','CANCELLED')
        AND (t.active_settlement_id IS NULL OR st.settlement_version<>s.result_version::text)
      ORDER BY s.updated_at,t.created_at LIMIT ${safeLimit}`;
    return rows.map(mapCandidate);
  }

  async get(ticketId: string): Promise<F1SettlementCandidate | null> {
    const [row] = await this.sql<CandidateRow[]>`SELECT t.id AS "ticketId",s.result_version AS "settlementVersion",
      st.settlement_version AS "activeSettlementVersion",s.state AS "sessionState",s.result_confirmed AS "resultConfirmed",
      r.classification,l.selection,l.supplier_market_id AS "supplierMarketId"
      FROM prediction.tickets t JOIN prediction.legs l ON l.ticket_id=t.id AND l.leg_number=1
      JOIN f1.sessions s ON t.fixture_id = 'f1:' || s.id::text
      LEFT JOIN f1.session_results r ON r.session_id=s.id AND r.version=s.result_version
      LEFT JOIN prediction.settlements st ON st.id=t.active_settlement_id
      WHERE t.id=${ticketId} LIMIT 1`;
    return row ? mapCandidate(row) : null;
  }
}

type SessionRow = {
  id: string; weekendId: string; kind: F1Session["kind"]; startsAt: Date | string;
  state: F1SessionState; resultVersion: number | null; resultConfirmed: boolean;
};

/** Serializes admin result entry per session (row lock) and applies the confirmed
 *  version to session, results and markets atomically. */
export class PostgresF1ResultEntryPort implements F1ResultEntryTransactionPort {
  constructor(private readonly sql: postgres.Sql) {}

  async run<T>(sessionId: string, work: (transaction: F1ResultEntryTransaction) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => {
      await tx`SELECT id FROM f1.sessions WHERE id=${sessionId} FOR UPDATE`;
      const transaction: F1ResultEntryTransaction = {
        getSession: async (id) => {
          const [row] = await tx<SessionRow[]>`SELECT id,weekend_id AS "weekendId",kind,starts_at AS "startsAt",
            state,result_version AS "resultVersion",result_confirmed AS "resultConfirmed"
            FROM f1.sessions WHERE id=${id} LIMIT 1`;
          if (!row) return null;
          return { ...row, resultVersion: row.resultVersion === null ? null : Number(row.resultVersion), startsAt: new Date(row.startsAt).toISOString() };
        },
        getActiveDriverCodes: async () => {
          const rows = await tx<Array<{ code: string }>>`SELECT code FROM f1.drivers WHERE active=true`;
          return new Set(rows.map((row) => row.code));
        },
        latestResultVersion: async (id) => {
          const [row] = await tx<Array<{ latest: string | number | null }>>`SELECT GREATEST(
            COALESCE((SELECT MAX(version) FROM f1.session_results WHERE session_id=${id}), 0),
            COALESCE((SELECT result_version FROM f1.sessions WHERE id=${id}), 0)) AS latest`;
          return Number(row?.latest ?? 0);
        },
        insertResult: async (record) => {
          await tx`INSERT INTO f1.session_results (session_id,version,classification,entered_by,entered_at)
            VALUES (${record.sessionId},${record.version},${JSON.stringify(record.classification)}::text::jsonb,${record.enteredBy},${record.enteredAt})`;
        },
        markConfirmed: async (input) => {
          const confirmedAt = input.confirmedAt;
          await tx`UPDATE f1.session_results SET confirmed_at=${confirmedAt} WHERE session_id=${input.sessionId} AND version=${input.version}`;
          await tx`UPDATE f1.sessions SET result_version=${input.version},result_confirmed=true,state='FINISHED',updated_at=${confirmedAt}
            WHERE id=${input.sessionId}`;
          await tx`UPDATE f1.markets SET status='CLOSED',updated_at=${confirmedAt} WHERE session_id=${input.sessionId} AND status='OPEN'`;
        },
        markCancelled: async (input) => {
          const occurredAt = input.occurredAt;
          await tx`UPDATE f1.sessions SET state='CANCELLED',result_version=${input.version},result_confirmed=true,updated_at=${occurredAt}
            WHERE id=${input.sessionId}`;
          await tx`UPDATE f1.markets SET status='CANCELLED',updated_at=${occurredAt} WHERE session_id=${input.sessionId}`;
        },
        appendAudit: async (event) => {
          await tx`INSERT INTO ops.audit_events (id,actor_user_id,action,target_type,target_id,result,metadata,occurred_at)
            VALUES (${event.id},${event.actorUserId},${event.action},${event.targetType},${event.targetId},${event.result},${JSON.stringify(event.metadata)}::text::jsonb,${event.occurredAt})`;
        },
      };
      return work(transaction);
    }) as Promise<T>;
  }
}
