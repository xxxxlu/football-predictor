import type postgres from "postgres";
import { projectSubmissionBoard, type SubmissionSport, type SubmissionStatusRow } from "@football-predictor/domain";

export class OperationError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = "OperationError"; }
}

type DbTimestamp = Date | string;
export type TicketHistoryRow = { ticketId: string; matchId: string; homeTeam: string; awayTeam: string; kickoffAt: DbTimestamp; matchStatus?: string; submittedAt: DbTimestamp; ownerUserId: string; displayName: string; selection: string; stakePoints: string; confirmedOdds: string; ticketStatus: string; outcome?: string | null; grossReturnPoints?: string | null; settlementVersion?: string | null };
export interface RoomTicketVisibilitySettings { preMatchStakeVisible: boolean; postMatchTicketVisible: boolean }
export type TicketHistoryVisibility = "REVEALED" | "STAKE_ONLY" | "PRIVATE";

export type CrossCompetitionHistoryRow = {
  ticketId: string; roomId: string; roomName: string; fixtureId: string;
  competitionId: string; competitionName: string; season: number;
  homeTeam: string; awayTeam: string; kickoffAt: DbTimestamp; selection: string;
  stakePoints: string; outcome: "WIN" | "LOSS" | "PUSH" | "CANCEL";
  grossReturnPoints: string; settlementVersion: string; settledAt: DbTimestamp;
  ledgerId: string; auditId: string;
};

type CompetitionArchive = {
  competitionId: string; competitionName: string; season: number;
  settledTickets: number; wins: number; losses: number; voids: number;
};

export function projectCrossCompetitionHistory(rows: CrossCompetitionHistoryRow[]) {
  const competitions = new Map<string, CompetitionArchive>();
  const summary = { settledTickets: 0, wins: 0, losses: 0, voids: 0 };
  const records = rows.map((row) => {
    const key = `${row.competitionId}:${row.season}`;
    const competition = competitions.get(key) ?? {
      competitionId: String(row.competitionId), competitionName: row.competitionName, season: row.season,
      settledTickets: 0, wins: 0, losses: 0, voids: 0,
    };
    competition.settledTickets += 1;
    summary.settledTickets += 1;
    const counter = row.outcome === "WIN" ? "wins" : row.outcome === "LOSS" ? "losses" : "voids";
    competition[counter] += 1;
    summary[counter] += 1;
    competitions.set(key, competition);
    return {
      ticketId: row.ticketId,
      room: { id: row.roomId, name: row.roomName },
      competition: { id: String(row.competitionId), name: row.competitionName, season: row.season },
      fixture: { id: row.fixtureId, homeTeam: row.homeTeam, awayTeam: row.awayTeam, kickoffAt: timestampIso(row.kickoffAt) },
      selection: row.selection,
      stakePoints: row.stakePoints,
      settlement: {
        outcome: row.outcome, grossReturnPoints: row.grossReturnPoints, version: row.settlementVersion,
        settledAt: timestampIso(row.settledAt), ledgerId: row.ledgerId, auditId: row.auditId,
      },
    };
  });
  return {
    scope: { performance: "USER_CROSS_COMPETITION" as const, balances: "PER_ROOM" as const },
    summary,
    competitions: [...competitions.values()],
    records,
  };
}

export function redactTicketHistory(row: TicketHistoryRow, viewerId: string, now: Date, settings: RoomTicketVisibilitySettings = { preMatchStakeVisible: false, postMatchTicketVisible: true }) {
  const isCurrentUser = row.ownerUserId === viewerId;
  const started = now >= timestampDate(row.kickoffAt) || (row.matchStatus !== undefined && row.matchStatus !== "SCHEDULED");
  const visibility: TicketHistoryVisibility = isCurrentUser
    ? "REVEALED"
    : started
      ? settings.postMatchTicketVisible ? "REVEALED" : "PRIVATE"
      : settings.preMatchStakeVisible ? "STAKE_ONLY" : "PRIVATE";
  const returnPoints = row.grossReturnPoints ?? null;
  const common = {
    ticketId: row.ticketId, matchId: row.matchId, homeTeam: row.homeTeam, awayTeam: row.awayTeam,
    kickoffAt: timestampIso(row.kickoffAt), submitted: true,
    owner: { userId: row.ownerUserId, displayName: row.displayName, isCurrentUser },
    visibility,
    status: row.ticketStatus !== "SETTLED" ? "FROZEN" : row.outcome === "WIN" ? "WON" : row.outcome === "LOSS" ? "LOST" : "VOID",
  };
  if (visibility === "PRIVATE") return common;
  const stake = { ...common, submittedAt: timestampIso(row.submittedAt), stakePoints: row.stakePoints };
  if (visibility === "STAKE_ONLY") return stake;
  return {
    ...stake,
    selection: row.selection,
    confirmedOdds: row.confirmedOdds,
    outcome: row.outcome ?? null,
    returnPoints,
    netPoints: returnPoints === null ? null : signed(String(Number(returnPoints) - Number(row.stakePoints))),
    settlementVersion: row.settlementVersion ?? null,
  };
}

export type LeaderboardSourceRow = { userId: string; displayName: string; availablePoints: string; frozenPoints: string; correctionDebt: string; settledTickets: number };

export function projectLeaderboard(rows: LeaderboardSourceRow[]) {
  return rows
    .map((row) => ({ ...row, net: Number(row.availablePoints) - Number(row.correctionDebt) - 10_000 }))
    .sort((a, b) => b.net - a.net || a.displayName.localeCompare(b.displayName))
    .map((row, index) => ({ rank: index + 1, userId: row.userId, displayName: row.displayName, netPoints: row.net.toFixed(2), availablePoints: row.availablePoints, frozenPoints: row.frozenPoints, settledTickets: row.settledTickets, movement: null }));
}

export type LedgerSourceRow = {
  id: string; roomId: string; kind: string; outcome: string | null; createdAt: DbTimestamp;
  availableDelta: string; frozenDelta: string; debtDelta: string;
  availableAfter: string; frozenAfter: string; debtAfter: string;
  ticketId: string | null; settlementVersion: string | null; auditId: string;
  reversesLedgerId: string | null; hasPriorSettlement: boolean;
};

export function projectLedgerEntry(row: LedgerSourceRow) {
  const type = ledgerType(row);
  return {
    id: row.id,
    type,
    roomId: row.roomId,
    ticketId: row.ticketId,
    settlementVersion: row.settlementVersion,
    auditId: row.auditId,
    reversesLedgerId: row.reversesLedgerId,
    createdAt: timestampIso(row.createdAt),
    availableDelta: signed(row.availableDelta),
    frozenDelta: signed(row.frozenDelta),
    debtDelta: signed(row.debtDelta),
    availableAfter: row.availableAfter,
    frozenAfter: row.frozenAfter,
    debtAfter: row.debtAfter,
    explanation: ledgerExplanation(row, type),
    ...(row.ticketId ? { reference: { kind: "ticket", id: row.ticketId } } : {}),
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
    const [row] = await this.sql<Array<{ id: string }>>`UPDATE identity.users SET nickname=${nickname},updated_at=${this.clock.now().toISOString()} WHERE id=${userId} AND status='ACTIVE' RETURNING id`;
    if (!row) throw new OperationError("UNAUTHENTICATED", 401);
    return this.getProfile(userId);
  }

  async accountHistory(userId: string) {
    const rows = await this.sql<CrossCompetitionHistoryRow[]>`
      SELECT t.id AS "ticketId",t.room_id AS "roomId",r.name AS "roomName",t.fixture_id AS "fixtureId",
        COALESCE(f.competition_id::text,'f1') AS "competitionId",COALESCE(f.competition_name,'FORMULA 1') AS "competitionName",
        COALESCE(f.season,fw.season) AS "season",
        COALESCE(f.home_team_name,fw.name) AS "homeTeam",COALESCE(f.away_team_name,fs.kind) AS "awayTeam",
        COALESCE(f.kickoff_at,fs.starts_at) AS "kickoffAt",
        l.selection,t.stake_points::text AS "stakePoints",s.outcome,s.gross_return_points::text AS "grossReturnPoints",
        s.settlement_version AS "settlementVersion",s.settled_at AS "settledAt",e.id AS "ledgerId",e.audit_id AS "auditId"
      FROM prediction.tickets t
      JOIN prediction.settlements s ON s.id=t.active_settlement_id AND s.status='ACTIVE'
      JOIN ledger.entries e ON e.id=s.ledger_id AND e.ticket_id=t.id AND e.settlement_version=s.settlement_version
      JOIN prediction.legs l ON l.ticket_id=t.id AND l.leg_number=1
      LEFT JOIN supplier.fixtures f ON f.id=t.fixture_id
      LEFT JOIN f1.sessions fs ON t.fixture_id='f1:'||fs.id::text
      LEFT JOIN f1.race_weekends fw ON fw.id=fs.weekend_id
      JOIN room.rooms r ON r.id=t.room_id
      WHERE t.user_id=${userId} AND (f.id IS NOT NULL OR fs.id IS NOT NULL)
      ORDER BY s.settled_at DESC,t.id DESC LIMIT 500`;
    return projectCrossCompetitionHistory(rows);
  }

  private async assertMember(roomId: string, userId: string, ownerOnly = false) {
    const [row] = await this.sql<Array<{ role: string; preMatchStakeVisible: boolean; postMatchTicketVisible: boolean }>>`
      SELECT m.role,r.pre_match_stake_visible AS "preMatchStakeVisible",r.post_match_ticket_visible AS "postMatchTicketVisible"
      FROM room.members m JOIN room.rooms r ON r.id=m.room_id
      WHERE m.room_id=${roomId} AND m.user_id=${userId} LIMIT 1`;
    if (!row) throw new OperationError("ROOM_NOT_FOUND", 404);
    if (ownerOnly && row.role !== "OWNER") throw new OperationError("FORBIDDEN", 403);
    return row;
  }

  async submissionStatus(roomId: string, userId: string) {
    await this.assertMember(roomId, userId, true);
    const [room] = await this.sql<Array<{ name: string }>>`SELECT name FROM room.rooms WHERE id=${roomId} LIMIT 1`;
    // Sport-neutral wall: football fixtures and F1 sessions project through the
    // same domain allowlist. Only the submitted EXISTS boolean leaves the data
    // layer — selections, stakes and odds are never selected here.
    type RawRow = { eventId: string; homeTeam: string; awayTeam: string; startsAt: DbTimestamp; lifecycleState: string; userId: string; displayName: string; submitted: boolean };
    const football = await this.sql<RawRow[]>`
      SELECT f.id AS "eventId",f.home_team_name AS "homeTeam",f.away_team_name AS "awayTeam",f.kickoff_at AS "startsAt",f.status AS "lifecycleState",
        m.user_id AS "userId",COALESCE(u.nickname,u.username_canonical) AS "displayName",
        EXISTS(SELECT 1 FROM prediction.tickets t WHERE t.room_id=m.room_id AND t.user_id=m.user_id AND t.fixture_id=f.id) AS submitted
      FROM supplier.fixtures f CROSS JOIN room.members m JOIN identity.users u ON u.id=m.user_id
      WHERE m.room_id=${roomId} ORDER BY f.kickoff_at,m.joined_at LIMIT 500`;
    const formula1 = await this.sql<RawRow[]>`
      SELECT 'f1:'||fs.id::text AS "eventId",fw.name AS "homeTeam",fs.kind AS "awayTeam",fs.starts_at AS "startsAt",fs.state AS "lifecycleState",
        m.user_id AS "userId",COALESCE(u.nickname,u.username_canonical) AS "displayName",
        EXISTS(SELECT 1 FROM prediction.tickets t WHERE t.room_id=m.room_id AND t.user_id=m.user_id AND t.fixture_id='f1:'||fs.id::text) AS submitted
      FROM f1.sessions fs JOIN f1.race_weekends fw ON fw.id=fs.weekend_id
      CROSS JOIN room.members m JOIN identity.users u ON u.id=m.user_id
      WHERE m.room_id=${roomId} ORDER BY fs.starts_at,m.joined_at LIMIT 500`;
    const toDomainRow = (sport: SubmissionSport) => (row: RawRow): SubmissionStatusRow => ({
      sport, eventId: row.eventId, homeTeam: row.homeTeam, awayTeam: row.awayTeam,
      startsAt: timestampIso(row.startsAt), lifecycleState: row.lifecycleState,
      userId: row.userId, displayName: row.displayName, submitted: row.submitted,
    });
    const fixtures = projectSubmissionBoard(
      [...football.map(toDomainRow("FOOTBALL")), ...formula1.map(toDomainRow("FORMULA_1"))],
      this.clock.now(),
    );
    return { roomId, roomName: room?.name ?? "", viewerRole: "room_owner" as const, fixtures };
  }

  async ticketHistory(roomId: string, userId: string) {
    const membership = await this.assertMember(roomId, userId);
    // F1 tickets have no supplier fixture; their event context comes from the f1
    // schema (weekend name as "home", session kind as "away", session start as kickoff).
    const rows = await this.sql<TicketHistoryRow[]>`
      SELECT t.id AS "ticketId",t.fixture_id AS "matchId",
        COALESCE(f.home_team_name,fw.name) AS "homeTeam",COALESCE(f.away_team_name,fs.kind) AS "awayTeam",
        COALESCE(f.kickoff_at,fs.starts_at) AS "kickoffAt",
        COALESCE(f.status,CASE fs.state WHEN 'FINISHED' THEN 'FINISHED' WHEN 'CANCELLED' THEN 'CANCELLED' ELSE 'SCHEDULED' END) AS "matchStatus",
        t.created_at AS "submittedAt",t.user_id AS "ownerUserId",COALESCE(u.nickname,u.username_canonical) AS "displayName",
        l.selection,l.decimal_odds AS "confirmedOdds",t.stake_points::text AS "stakePoints",t.status AS "ticketStatus",s.outcome,
        s.gross_return_points::text AS "grossReturnPoints",s.settlement_version AS "settlementVersion"
      FROM prediction.tickets t JOIN prediction.legs l ON l.ticket_id=t.id AND l.leg_number=1
      LEFT JOIN supplier.fixtures f ON f.id=t.fixture_id
      LEFT JOIN f1.sessions fs ON t.fixture_id='f1:'||fs.id::text
      LEFT JOIN f1.race_weekends fw ON fw.id=fs.weekend_id
      JOIN identity.users u ON u.id=t.user_id LEFT JOIN prediction.settlements s ON s.id=t.active_settlement_id
      WHERE t.room_id=${roomId} AND (f.id IS NOT NULL OR fs.id IS NOT NULL) ORDER BY t.created_at DESC LIMIT 200`;
    const settings = { preMatchStakeVisible: membership.preMatchStakeVisible, postMatchTicketVisible: membership.postMatchTicketVisible };
    return rows.map((row) => redactTicketHistory(row, userId, this.clock.now(), settings));
  }

  async ledger(roomId: string, userId: string) {
    await this.assertMember(roomId, userId);
    const rows = await this.sql<LedgerSourceRow[]>`
      SELECT e.id,e.room_id AS "roomId",e.kind,e.created_at AS "createdAt",e.available_delta_points::text AS "availableDelta",e.frozen_delta_points::text AS "frozenDelta",
        e.correction_debt_delta_points::text AS "debtDelta",
        SUM(e.available_delta_points) OVER (ORDER BY e.created_at,e.id)::text AS "availableAfter",
        SUM(e.frozen_delta_points) OVER (ORDER BY e.created_at,e.id)::text AS "frozenAfter",
        SUM(e.correction_debt_delta_points) OVER (ORDER BY e.created_at,e.id)::text AS "debtAfter",e.ticket_id AS "ticketId",
        e.settlement_version AS "settlementVersion",e.audit_id AS "auditId",e.reverses_ledger_id AS "reversesLedgerId",s.outcome,
        EXISTS(SELECT 1 FROM prediction.settlements prior WHERE prior.ticket_id=e.ticket_id AND prior.settled_at<e.created_at) AS "hasPriorSettlement"
      FROM ledger.entries e LEFT JOIN prediction.settlements s ON s.ledger_id=e.id
      WHERE e.room_id=${roomId} AND e.user_id=${userId} ORDER BY e.created_at DESC,e.id DESC LIMIT 200`;
    return { entries: rows.map(projectLedgerEntry), nextCursor: null };
  }

  async leaderboard(roomId: string, userId: string) {
    await this.assertMember(roomId, userId);
    const rows = await this.sql<LeaderboardSourceRow[]>`
      SELECT a.user_id AS "userId",COALESCE(u.nickname,u.username_canonical) AS "displayName",a.available_points::text AS "availablePoints",
        a.frozen_points::text AS "frozenPoints",a.correction_debt::text AS "correctionDebt",COUNT(t.id) FILTER (WHERE t.status='SETTLED')::int AS "settledTickets"
      FROM ledger.point_accounts a JOIN identity.users u ON u.id=a.user_id LEFT JOIN prediction.tickets t ON t.room_id=a.room_id AND t.user_id=a.user_id
      WHERE a.room_id=${roomId} GROUP BY a.user_id,u.nickname,u.username_canonical,a.available_points,a.frozen_points,a.correction_debt`;
    return projectLeaderboard(rows);
  }

  async adminStatus(userId: string) {
    const [admin] = await this.sql<Array<{ allowed: boolean }>>`SELECT is_super_admin AS allowed FROM identity.users WHERE id=${userId} AND status='ACTIVE' LIMIT 1`;
    if (!admin?.allowed) throw new OperationError("FORBIDDEN", 403);
    const now = this.clock.now(); const nowIso = now.toISOString(); const date = nowIso.slice(0, 10);
    // postgres.js 参数必须传 ISO 字符串而非 Date 实例：Next.js 运行时对全局 Date 做了插桩，
    // postgres.js 的 instanceof Date 类型推断失效，Date 参数会抛 ERR_INVALID_ARG_TYPE。
    const staleBefore = new Date(now.getTime() - 600000).toISOString();
    const [budget] = await this.sql<Array<{ generalUsed: number; settlementUsed: number }>>`SELECT (static_used+prematch_odds_used+live_used)::int AS "generalUsed",settlement_used::int AS "settlementUsed" FROM supplier.request_budgets WHERE billing_day=${date}::date`;
    const [cache] = await this.sql<Array<{ freshMatches: number; staleMatches: number; unavailableMatches: number; oldestDataAsOf: DbTimestamp | null }>>`SELECT COUNT(*) FILTER (WHERE status='OPEN' AND data_as_of>=${staleBefore}::timestamptz)::int AS "freshMatches",COUNT(*) FILTER (WHERE status='OPEN' AND data_as_of<${staleBefore}::timestamptz)::int AS "staleMatches",COUNT(*) FILTER (WHERE status='DATA_UNAVAILABLE')::int AS "unavailableMatches",MIN(data_as_of) AS "oldestDataAsOf" FROM supplier.markets`;
    const [settlement] = await this.sql<Array<{ pending: number }>>`SELECT COUNT(*) FILTER (WHERE status='PENDING')::int AS pending FROM prediction.tickets`;
    const [jobs] = await this.sql<Array<{ queued: number; running: number; failed: number; maxLagSeconds: number }>>`SELECT COUNT(*) FILTER (WHERE status='QUEUED')::int AS queued,COUNT(*) FILTER (WHERE status='RUNNING')::int AS running,COUNT(*) FILTER (WHERE status='FAILED')::int AS failed,COALESCE(MAX(EXTRACT(EPOCH FROM (${nowIso}::timestamptz-available_at))) FILTER (WHERE status='QUEUED'),0)::int AS "maxLagSeconds" FROM ops.jobs`;
    const overall = (jobs?.failed ?? 0) > 0 ? "CRITICAL" : (settlement?.pending ?? 0) > 0 || (cache?.staleMatches ?? 0) > 0 ? "DEGRADED" : "HEALTHY";
    return { generatedAt: now.toISOString(), overall, supplierBudget: { utcDate: date, limit: 95, generalUsed: budget?.generalUsed ?? 0, settlementUsed: budget?.settlementUsed ?? 0, settlementReserved: 10 }, cache: { freshMatches: cache?.freshMatches ?? 0, staleMatches: cache?.staleMatches ?? 0, unavailableMatches: cache?.unavailableMatches ?? 0, oldestDataAsOf: cache?.oldestDataAsOf ? timestampIso(cache.oldestDataAsOf) : null }, settlement: { pending: settlement?.pending ?? 0, failed: 0, oldestPendingAt: null, lastSuccessAt: null }, jobs: { queued: jobs?.queued ?? 0, running: jobs?.running ?? 0, failed: jobs?.failed ?? 0, maxLagSeconds: jobs?.maxLagSeconds ?? 0 } };
  }
}

function signed(value: string) { const number = Number(value); return `${number > 0 ? "+" : ""}${number.toFixed(2)}`; }
function timestampDate(value: DbTimestamp) { return value instanceof Date ? value : new Date(value); }
function timestampIso(value: DbTimestamp) { return timestampDate(value).toISOString(); }
function ledgerType(row: Pick<LedgerSourceRow, "kind" | "outcome" | "hasPriorSettlement">) {
  if (row.kind === "INITIAL_GRANT") return "GRANT";
  if (row.kind === "PREDICTION_FREEZE") return "FREEZE";
  if (row.kind === "SETTLEMENT_REVERSAL") return "REVERSAL";
  if (row.kind === "DEBT_OFFSET") return "DEBT_OFFSET";
  if (row.kind === "REFUND" || (row.kind === "SETTLEMENT" && (row.outcome === "PUSH" || row.outcome === "CANCEL"))) return "VOID";
  if (row.kind === "SETTLEMENT") return row.hasPriorSettlement ? "RE_SETTLE" : "SETTLE";
  return "RE_SETTLE";
}
function ledgerExplanation(row: Pick<LedgerSourceRow, "kind" | "outcome" | "availableDelta" | "frozenDelta" | "debtDelta" | "settlementVersion">, type: string) {
  if (type === "GRANT") return "首次加入房间的初始积分。";
  if (type === "FREEZE") return "预测已接受，投入从可用积分转入冻结积分；结算前不计入排行榜净积分。";
  if (type === "VOID") return `比赛取消或走盘，本次退回冻结投入${row.settlementVersion ? `（赛果版本 ${row.settlementVersion}）` : ""}。`;
  if (type === "REVERSAL") {
    const debt = Number(row.debtDelta);
    return debt > 0 ? `赛果更正已冲正原结算；可用积分不足的 ${debt.toFixed(2)} 分记为更正债务，后续收益会优先抵扣。` : "赛果更正已冲正原结算，原记录保留且不会被覆盖。";
  }
  const debtOffset = Math.max(0, -Number(row.debtDelta));
  const prefix = type === "RE_SETTLE" ? "赛果更正后已按新版本重新结算。" : "赛果已结算，冻结投入已释放。";
  return debtOffset > 0 ? `${prefix} 本次收益中 ${debtOffset.toFixed(2)} 分已优先抵扣更正债务。` : prefix;
}
