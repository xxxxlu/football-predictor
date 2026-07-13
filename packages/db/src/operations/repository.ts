import type postgres from "postgres";

export class OperationError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = "OperationError"; }
}

export type TicketHistoryRow = { ticketId: string; matchId: string; homeTeam: string; awayTeam: string; kickoffAt: Date; matchStatus?: string; submittedAt: Date; ownerUserId: string; displayName: string; selection: string; stakePoints: string; confirmedOdds: string; ticketStatus: string; outcome?: string | null };

export function redactTicketHistory(row: TicketHistoryRow, viewerId: string, now: Date) {
  const isCurrentUser = row.ownerUserId === viewerId;
  const reveal = isCurrentUser || now >= row.kickoffAt || (row.matchStatus !== undefined && row.matchStatus !== "SCHEDULED");
  return {
    ticketId: row.ticketId, matchId: row.matchId, homeTeam: row.homeTeam, awayTeam: row.awayTeam,
    kickoffAt: row.kickoffAt.toISOString(), submittedAt: row.submittedAt.toISOString(),
    owner: { userId: row.ownerUserId, displayName: row.displayName, isCurrentUser },
    visibility: reveal ? "REVEALED" as const : "PRIVATE" as const,
    ...(reveal ? { selection: row.selection, stakePoints: row.stakePoints, confirmedOdds: row.confirmedOdds } : {}),
    status: row.ticketStatus !== "SETTLED" ? "FROZEN" : row.outcome === "WIN" ? "WON" : row.outcome === "LOSS" ? "LOST" : "VOID",
    returnPoints: null,
  };
}

export class PostgresOperationsRepository {
  constructor(private readonly sql: postgres.Sql, private readonly clock: { now(): Date } = { now: () => new Date() }) {}

  async getProfile(userId: string) {
    const [row] = await this.sql<Array<{ id: string; username: string; nickname: string | null; superAdmin: boolean }>>`
      SELECT id,username_canonical AS username,nickname,is_super_admin AS "superAdmin" FROM identity.users WHERE id=${userId} AND status='ACTIVE' LIMIT 1`;
    if (!row) throw new OperationError("UNAUTHENTICATED", 401);
    return { id: row.id, username: row.username, nickname: row.nickname ?? row.username, roles: [row.superAdmin ? "super_admin" : "user"] };
  }

  async updateNickname(userId: string, nickname: string) {
    const [row] = await this.sql<Array<{ id: string }>>`UPDATE identity.users SET nickname=${nickname},updated_at=${this.clock.now()} WHERE id=${userId} AND status='ACTIVE' RETURNING id`;
    if (!row) throw new OperationError("UNAUTHENTICATED", 401);
    return this.getProfile(userId);
  }

  private async assertMember(roomId: string, userId: string, ownerOnly = false) {
    const [row] = await this.sql<Array<{ role: string }>>`SELECT role FROM room.members WHERE room_id=${roomId} AND user_id=${userId} LIMIT 1`;
    if (!row) throw new OperationError("ROOM_NOT_FOUND", 404);
    if (ownerOnly && row.role !== "OWNER") throw new OperationError("FORBIDDEN", 403);
    return row.role;
  }

  async submissionStatus(roomId: string, userId: string) {
    await this.assertMember(roomId, userId, true);
    const [room] = await this.sql<Array<{ name: string }>>`SELECT name FROM room.rooms WHERE id=${roomId} LIMIT 1`;
    const rows = await this.sql<Array<{ matchId: string; homeTeam: string; awayTeam: string; kickoffAt: Date; matchStatus: string; userId: string; displayName: string; submitted: boolean }>>`
      SELECT f.id AS "matchId",f.home_team_name AS "homeTeam",f.away_team_name AS "awayTeam",f.kickoff_at AS "kickoffAt",f.status AS "matchStatus",
        m.user_id AS "userId",COALESCE(u.nickname,u.username_canonical) AS "displayName",
        EXISTS(SELECT 1 FROM prediction.tickets t WHERE t.room_id=m.room_id AND t.user_id=m.user_id AND t.fixture_id=f.id) AS submitted
      FROM supplier.fixtures f CROSS JOIN room.members m JOIN identity.users u ON u.id=m.user_id
      WHERE m.room_id=${roomId} ORDER BY f.kickoff_at,m.joined_at LIMIT 500`;
    const fixtures = new Map<string, { matchId: string; homeTeam: string; awayTeam: string; kickoffAt: string; status: "OPEN" | "CLOSED" | "FINISHED"; members: Array<{ userId: string; displayName: string; submitted: boolean }> }>();
    for (const row of rows) {
      let fixture = fixtures.get(row.matchId);
      if (!fixture) { fixture = { matchId: row.matchId, homeTeam: row.homeTeam, awayTeam: row.awayTeam, kickoffAt: row.kickoffAt.toISOString(), status: row.matchStatus === "FINISHED" ? "FINISHED" : this.clock.now() >= row.kickoffAt ? "CLOSED" : "OPEN", members: [] }; fixtures.set(row.matchId, fixture); }
      fixture.members.push({ userId: row.userId, displayName: row.displayName, submitted: row.submitted });
    }
    return { roomId, roomName: room?.name ?? "", viewerRole: "room_owner" as const, fixtures: [...fixtures.values()] };
  }

  async ticketHistory(roomId: string, userId: string) {
    await this.assertMember(roomId, userId);
    const rows = await this.sql<TicketHistoryRow[]>`
      SELECT t.id AS "ticketId",t.fixture_id AS "matchId",f.home_team_name AS "homeTeam",f.away_team_name AS "awayTeam",f.kickoff_at AS "kickoffAt",f.status AS "matchStatus",
        t.created_at AS "submittedAt",t.user_id AS "ownerUserId",COALESCE(u.nickname,u.username_canonical) AS "displayName",
        l.selection,l.decimal_odds AS "confirmedOdds",t.stake_points::text AS "stakePoints",t.status AS "ticketStatus",s.outcome
      FROM prediction.tickets t JOIN prediction.legs l ON l.ticket_id=t.id AND l.leg_number=1
      JOIN supplier.fixtures f ON f.id=t.fixture_id JOIN identity.users u ON u.id=t.user_id LEFT JOIN prediction.settlements s ON s.id=t.active_settlement_id
      WHERE t.room_id=${roomId} ORDER BY t.created_at DESC LIMIT 200`;
    return rows.map((row) => redactTicketHistory(row, userId, this.clock.now()));
  }

  async ledger(roomId: string, userId: string) {
    await this.assertMember(roomId, userId);
    const rows = await this.sql<Array<{ id: string; kind: string; createdAt: Date; availableDelta: string; frozenDelta: string; debtDelta: string; availableAfter: string; frozenAfter: string; debtAfter: string; ticketId: string | null }>>`
      SELECT e.id,e.kind,e.created_at AS "createdAt",e.available_delta_points::text AS "availableDelta",e.frozen_delta_points::text AS "frozenDelta",
        e.correction_debt_delta_points::text AS "debtDelta",
        SUM(e.available_delta_points) OVER (ORDER BY e.created_at,e.id)::text AS "availableAfter",
        SUM(e.frozen_delta_points) OVER (ORDER BY e.created_at,e.id)::text AS "frozenAfter",
        SUM(e.correction_debt_delta_points) OVER (ORDER BY e.created_at,e.id)::text AS "debtAfter",e.ticket_id AS "ticketId"
      FROM ledger.entries e WHERE e.room_id=${roomId} AND e.user_id=${userId} ORDER BY e.created_at DESC,e.id DESC LIMIT 200`;
    return { entries: rows.map((row) => ({ id: row.id, type: ledgerType(row.kind), createdAt: row.createdAt.toISOString(), availableDelta: signed(row.availableDelta), frozenDelta: signed(row.frozenDelta), debtDelta: signed(row.debtDelta), availableAfter: row.availableAfter, frozenAfter: row.frozenAfter, debtAfter: row.debtAfter, explanation: ledgerExplanation(row.kind), ...(row.ticketId ? { reference: { kind: "ticket", id: row.ticketId } } : {}) })), nextCursor: null };
  }

  async leaderboard(roomId: string, userId: string) {
    await this.assertMember(roomId, userId);
    const rows = await this.sql<Array<{ userId: string; displayName: string; availablePoints: string; frozenPoints: string; correctionDebt: string; settledTickets: number }>>`
      SELECT a.user_id AS "userId",COALESCE(u.nickname,u.username_canonical) AS "displayName",a.available_points::text AS "availablePoints",
        a.frozen_points::text AS "frozenPoints",a.correction_debt::text AS "correctionDebt",COUNT(t.id) FILTER (WHERE t.status='SETTLED')::int AS "settledTickets"
      FROM ledger.point_accounts a JOIN identity.users u ON u.id=a.user_id LEFT JOIN prediction.tickets t ON t.room_id=a.room_id AND t.user_id=a.user_id
      WHERE a.room_id=${roomId} GROUP BY a.user_id,u.nickname,u.username_canonical,a.available_points,a.frozen_points,a.correction_debt`;
    return rows.map((row) => ({ ...row, net: Number(row.availablePoints) + Number(row.frozenPoints) - Number(row.correctionDebt) - 10000 })).sort((a, b) => b.net - a.net || a.displayName.localeCompare(b.displayName)).map((row, index) => ({ rank: index + 1, userId: row.userId, displayName: row.displayName, netPoints: row.net.toFixed(2), availablePoints: row.availablePoints, frozenPoints: row.frozenPoints, settledTickets: row.settledTickets, movement: null }));
  }

  async adminStatus(userId: string) {
    const [admin] = await this.sql<Array<{ allowed: boolean }>>`SELECT is_super_admin AS allowed FROM identity.users WHERE id=${userId} AND status='ACTIVE' LIMIT 1`;
    if (!admin?.allowed) throw new OperationError("FORBIDDEN", 403);
    const now = this.clock.now(); const date = now.toISOString().slice(0, 10);
    const [budget] = await this.sql<Array<{ generalUsed: number; settlementUsed: number }>>`SELECT (static_used+prematch_odds_used+live_used)::int AS "generalUsed",settlement_used::int AS "settlementUsed" FROM supplier.request_budgets WHERE billing_day=${date}::date`;
    const [cache] = await this.sql<Array<{ freshMatches: number; staleMatches: number; unavailableMatches: number; oldestDataAsOf: Date | null }>>`SELECT COUNT(*) FILTER (WHERE status='OPEN' AND data_as_of>=${new Date(now.getTime()-600000)})::int AS "freshMatches",COUNT(*) FILTER (WHERE status='OPEN' AND data_as_of<${new Date(now.getTime()-600000)})::int AS "staleMatches",COUNT(*) FILTER (WHERE status='DATA_UNAVAILABLE')::int AS "unavailableMatches",MIN(data_as_of) AS "oldestDataAsOf" FROM supplier.markets`;
    const [settlement] = await this.sql<Array<{ pending: number }>>`SELECT COUNT(*) FILTER (WHERE status='PENDING')::int AS pending FROM prediction.tickets`;
    const [jobs] = await this.sql<Array<{ queued: number; running: number; failed: number; maxLagSeconds: number }>>`SELECT COUNT(*) FILTER (WHERE status='QUEUED')::int AS queued,COUNT(*) FILTER (WHERE status='RUNNING')::int AS running,COUNT(*) FILTER (WHERE status='FAILED')::int AS failed,COALESCE(MAX(EXTRACT(EPOCH FROM (${now}::timestamptz-available_at))) FILTER (WHERE status='QUEUED'),0)::int AS "maxLagSeconds" FROM ops.jobs`;
    const overall = (jobs?.failed ?? 0) > 0 ? "CRITICAL" : (settlement?.pending ?? 0) > 0 || (cache?.staleMatches ?? 0) > 0 ? "DEGRADED" : "HEALTHY";
    return { generatedAt: now.toISOString(), overall, supplierBudget: { utcDate: date, limit: 95, generalUsed: budget?.generalUsed ?? 0, settlementUsed: budget?.settlementUsed ?? 0, settlementReserved: 10 }, cache: { freshMatches: cache?.freshMatches ?? 0, staleMatches: cache?.staleMatches ?? 0, unavailableMatches: cache?.unavailableMatches ?? 0, oldestDataAsOf: cache?.oldestDataAsOf?.toISOString() ?? null }, settlement: { pending: settlement?.pending ?? 0, failed: 0, oldestPendingAt: null, lastSuccessAt: null }, jobs: { queued: jobs?.queued ?? 0, running: jobs?.running ?? 0, failed: jobs?.failed ?? 0, maxLagSeconds: jobs?.maxLagSeconds ?? 0 } };
  }
}

function signed(value: string) { const number = Number(value); return `${number > 0 ? "+" : ""}${number.toFixed(2)}`; }
function ledgerType(kind: string) { return ({ INITIAL_GRANT: "GRANT", PREDICTION_FREEZE: "FREEZE", SETTLEMENT: "SETTLE", SETTLEMENT_REVERSAL: "REVERSAL" } as Record<string,string>)[kind] ?? "RE_SETTLE"; }
function ledgerExplanation(kind: string) { return kind === "INITIAL_GRANT" ? "首次加入房间的初始积分。" : kind === "PREDICTION_FREEZE" ? "预测已接受，投入从可用积分转入冻结积分。" : "由结算或更正生成的不可变账本记录。"; }
