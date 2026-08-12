import type postgres from "postgres";
import { avatarProjection, encodeKeysetCursor, projectSubmissionBoard, type KeysetCursor, type SubmissionSport, type SubmissionStatusRow } from "@pulse/domain";
import { avatarColumns, avatarJoin, avatarJoinUnlessViewerBlocked } from "../identity/avatar-projection.js";
import { readOperatorAuthorization, type OperatorAuthorization } from "../identity/operator-roles.js";

export class OperationError extends Error {
  constructor(readonly code: string, readonly status: number, readonly details?: Record<string, unknown>) { super(code); this.name = "OperationError"; }
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

export type LeaderboardSourceRow = { userId: string; displayName: string; availablePoints: string; frozenPoints: string; correctionDebt: string; grantedPoints: string; ownerGrantedPoints: string; settledTickets: number; avatarPublicId?: string | null; avatarVersion?: number | null };

/**
 * Net points subtract every grant the account ever received — the initial
 * grant and any owner grants (FR45: 补分不计入预测净收益和收益排名). For an
 * account whose only grant is the initial 10,000 this is exactly the old
 * hardcoded `- 10_000`, so zero-grant rooms rank identically to before.
 */
export function projectLeaderboard(rows: LeaderboardSourceRow[]) {
  return rows
    .map((row) => ({ ...row, net: Number(row.availablePoints) - Number(row.correctionDebt) - Number(row.grantedPoints) }))
    .sort((a, b) => b.net - a.net || a.displayName.localeCompare(b.displayName))
    .map((row, index) => ({ rank: index + 1, userId: row.userId, displayName: row.displayName, netPoints: row.net.toFixed(2), availablePoints: row.availablePoints, frozenPoints: row.frozenPoints, grantedPoints: Number(row.grantedPoints).toFixed(2), ownerGrantedPoints: Number(row.ownerGrantedPoints).toFixed(2), settledTickets: row.settledTickets, movement: null, ...avatarProjection(row) }));
}

/** Entries per ledger page. Unchanged from the pre-paging cap, so page one
 *  still shows exactly what it always did — it is now simply not the last page. */
export const LEDGER_PAGE_SIZE = 200;

/** A hard ceiling on the leaderboard, cut from the bottom of the standing (the
 *  query orders by net points) rather than at an arbitrary point. Rooms are
 *  friend-sized groups and the schema imposes no member cap, so this is a
 *  runaway guard, not a product limit. */
export const LEADERBOARD_MAX_ROWS = 500;

type LedgerBalanceRow = { available: string; frozen: string; debt: string };
const ZERO_BALANCE: LedgerBalanceRow = { available: "0", frozen: "0", debt: "0" };

/**
 * Page one's stand-in cursor. Every real entry sorts strictly below it, so both
 * pages run the same row-comparison — one statement, one plan, and the index
 * range scan a `cursor IS NULL OR ...` disjunction would have thrown away.
 *
 * A finite timestamp, not `'infinity'`: postgres.js serializes anything the
 * server describes as `timestamptz` through `new Date(x).toISOString()`
 * (`postgres/src/types.js`), so Postgres's special timestamp inputs are not
 * bindable as parameters at all — `'infinity'` becomes an Invalid Date and
 * throws in the driver before a packet is sent.
 */
export const LEDGER_CURSOR_START: KeysetCursor = { createdAt: "9999-12-31T23:59:59.999Z", id: "ffffffff-ffff-ffff-ffff-ffffffffffff" };

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

  // `roles` keeps its legacy super_admin/user shape for existing callers; the
  // capability list is what the back-office navigation renders from, so an entry
  // only appears for an operator who actually holds the duty behind it. The
  // navigation is a convenience — every API still authorizes on its own.
  async getProfile(userId: string) {
    const [row] = await this.sql<Array<{ id: string; username: string; nickname: string | null; superAdmin: boolean; avatarPublicId: string | null; avatarVersion: number | null }>>`
      SELECT u.id,u.username_canonical AS username,u.nickname,u.is_super_admin AS "superAdmin",${avatarColumns(this.sql)}
      FROM identity.users u ${avatarJoin(this.sql)}
      WHERE u.id=${userId} AND u.status='ACTIVE' LIMIT 1`;
    if (!row) throw new OperationError("UNAUTHENTICATED", 401);
    const authorization = await readOperatorAuthorization(this.sql, userId);
    return {
      id: row.id,
      username: row.username,
      nickname: row.nickname ?? row.username,
      roles: [row.superAdmin ? "super_admin" : "user"],
      operatorRoles: authorization.roles,
      capabilities: authorization.capabilities,
      // Story 12.6: the account page reads its own avatar from the same call it
      // already makes, so the member pass never renders an empty slot first.
      ...avatarProjection(row),
    };
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
    type RawRow = { eventId: string; homeTeam: string; awayTeam: string; startsAt: DbTimestamp; lifecycleState: string; userId: string; displayName: string; submitted: boolean; avatarPublicId: string | null; avatarVersion: number | null };
    const football = await this.sql<RawRow[]>`
      SELECT f.id AS "eventId",f.home_team_name AS "homeTeam",f.away_team_name AS "awayTeam",f.kickoff_at AS "startsAt",f.status AS "lifecycleState",
        m.user_id AS "userId",COALESCE(u.nickname,u.username_canonical) AS "displayName",
        EXISTS(SELECT 1 FROM prediction.tickets t WHERE t.room_id=m.room_id AND t.user_id=m.user_id AND t.fixture_id=f.id) AS submitted,
        ${avatarColumns(this.sql)}
      FROM supplier.fixtures f CROSS JOIN room.members m JOIN identity.users u ON u.id=m.user_id
      ${avatarJoinUnlessViewerBlocked(this.sql, userId)}
      WHERE m.room_id=${roomId} ORDER BY f.kickoff_at,m.joined_at LIMIT 500`;
    const formula1 = await this.sql<RawRow[]>`
      SELECT 'f1:'||fs.id::text AS "eventId",fw.name AS "homeTeam",fs.kind AS "awayTeam",fs.starts_at AS "startsAt",fs.state AS "lifecycleState",
        m.user_id AS "userId",COALESCE(u.nickname,u.username_canonical) AS "displayName",
        EXISTS(SELECT 1 FROM prediction.tickets t WHERE t.room_id=m.room_id AND t.user_id=m.user_id AND t.fixture_id='f1:'||fs.id::text) AS submitted,
        ${avatarColumns(this.sql)}
      FROM f1.sessions fs JOIN f1.race_weekends fw ON fw.id=fs.weekend_id
      CROSS JOIN room.members m JOIN identity.users u ON u.id=m.user_id
      ${avatarJoinUnlessViewerBlocked(this.sql, userId)}
      WHERE m.room_id=${roomId} ORDER BY fs.starts_at,m.joined_at LIMIT 500`;
    const toDomainRow = (sport: SubmissionSport) => (row: RawRow): SubmissionStatusRow => ({
      sport, eventId: row.eventId, homeTeam: row.homeTeam, awayTeam: row.awayTeam,
      startsAt: timestampIso(row.startsAt), lifecycleState: row.lifecycleState,
      userId: row.userId, displayName: row.displayName, submitted: row.submitted,
      ...avatarProjection(row),
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

  /** The caller's own tickets (own rows only, so no redaction) — the read behind the
   *  prediction slip's already-staked markets (一人一注). One fixture when `fixtureId`
   *  is given (an F1 session detail shows one event); otherwise every unsettled ticket
   *  in the room, because the football match list renders one slip per fixture and must
   *  not fan out a request per card. */
  async myTickets(roomId: string, userId: string, fixtureId?: string) {
    await this.assertMember(roomId, userId);
    type Row = { ticketId: string; marketId: string; fixtureId: string; status: string };
    return fixtureId
      ? this.sql<Row[]>`
        SELECT id AS "ticketId",market_id AS "marketId",fixture_id AS "fixtureId",status
        FROM prediction.tickets
        WHERE room_id=${roomId} AND user_id=${userId} AND fixture_id=${fixtureId}
        ORDER BY created_at DESC LIMIT 50`
      : this.sql<Row[]>`
        SELECT id AS "ticketId",market_id AS "marketId",fixture_id AS "fixtureId",status
        FROM prediction.tickets
        WHERE room_id=${roomId} AND user_id=${userId} AND status='PENDING'
        ORDER BY created_at DESC LIMIT 500`;
  }

  /**
   * The member's own money explanation, newest first.
   *
   * The running balance is a prefix sum from the account's first entry, which
   * used to be read as `SUM(...) OVER (ORDER BY created_at, id)` — a window
   * evaluated before `LIMIT`, so every open of the page re-scanned the account's
   * entire history no matter how few rows were shown. It is derived instead
   * from an anchor (the balance this page opens on) minus a window confined to
   * the page itself. Page one costs a primary-key lookup plus the page; later
   * pages add one aggregate over the rows already paged past.
   *
   * The anchor is exact because `ledger.point_accounts` is maintained as the
   * sum of `ledger.entries` deltas: every insert site (room creation, join,
   * prediction freeze, settlement, reversal) writes both in one transaction,
   * and entries are append-only (`ledger_entries_idempotency_unique`, FK
   * `ON DELETE RESTRICT`). It is also stable under concurrent writes — an entry
   * landing mid-read raises the account balance and joins the backed-out set in
   * equal measure. Balances stay in `numeric` end to end, so paging introduces
   * no rounding.
   */
  async ledger(roomId: string, userId: string, options: { cursor?: KeysetCursor } = {}) {
    await this.assertMember(roomId, userId);
    const { cursor } = options;
    // The account row is the balance standing after the newest entry there is.
    const [account] = await this.sql<LedgerBalanceRow[]>`
      SELECT available_points::text AS available,frozen_points::text AS frozen,correction_debt::text AS debt
      FROM ledger.point_accounts WHERE room_id=${roomId} AND user_id=${userId}`;
    // No account row means no entries either; the empty page is the honest answer.
    if (!account) return { entries: [], nextCursor: null };

    // Past page one, back that out over every entry from the cursor row upward
    // — the rows the reader has already been shown — to reach this page's
    // opening balance. Derived server-side on purpose: a cursor carrying its own
    // balances would let a tampered value render wrong numbers on the one screen
    // whose whole job is explaining where the points went.
    const [shown = ZERO_BALANCE] = cursor
      ? await this.sql<LedgerBalanceRow[]>`
        SELECT COALESCE(SUM(available_delta_points),0)::text AS available,COALESCE(SUM(frozen_delta_points),0)::text AS frozen,
          COALESCE(SUM(correction_debt_delta_points),0)::text AS debt
        FROM ledger.entries
        WHERE room_id=${roomId} AND user_id=${userId} AND (created_at,id) >= (${cursor.createdAt}::timestamptz,${cursor.id}::uuid)`
      : [ZERO_BALANCE];

    const rows = await this.sql<LedgerSourceRow[]>`
      WITH page AS (
        SELECT e.id,e.room_id,e.kind,e.created_at,e.available_delta_points,e.frozen_delta_points,e.correction_debt_delta_points,
          e.ticket_id,e.settlement_version,e.audit_id,e.reverses_ledger_id
        FROM ledger.entries e
        WHERE e.room_id=${roomId} AND e.user_id=${userId}
          AND (e.created_at,e.id) < (${cursor?.createdAt ?? LEDGER_CURSOR_START.createdAt}::timestamptz,${cursor?.id ?? LEDGER_CURSOR_START.id}::uuid)
        ORDER BY e.created_at DESC,e.id DESC LIMIT ${LEDGER_PAGE_SIZE + 1}
      ), running AS (
        SELECT p.*,
          COALESCE(SUM(p.available_delta_points) OVER newer,0) AS newer_available,
          COALESCE(SUM(p.frozen_delta_points) OVER newer,0) AS newer_frozen,
          COALESCE(SUM(p.correction_debt_delta_points) OVER newer,0) AS newer_debt
        FROM page p
        WINDOW newer AS (ORDER BY p.created_at DESC,p.id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
      )
      SELECT r.id,r.room_id AS "roomId",r.kind,r.created_at AS "createdAt",r.available_delta_points::text AS "availableDelta",r.frozen_delta_points::text AS "frozenDelta",
        r.correction_debt_delta_points::text AS "debtDelta",
        (${account.available}::numeric - ${shown.available}::numeric - r.newer_available)::text AS "availableAfter",
        (${account.frozen}::numeric - ${shown.frozen}::numeric - r.newer_frozen)::text AS "frozenAfter",
        (${account.debt}::numeric - ${shown.debt}::numeric - r.newer_debt)::text AS "debtAfter",r.ticket_id AS "ticketId",
        r.settlement_version AS "settlementVersion",r.audit_id AS "auditId",r.reverses_ledger_id AS "reversesLedgerId",s.outcome,
        EXISTS(SELECT 1 FROM prediction.settlements prior WHERE prior.ticket_id=r.ticket_id AND prior.settled_at<r.created_at) AS "hasPriorSettlement"
      FROM running r LEFT JOIN prediction.settlements s ON s.ledger_id=r.id
      ORDER BY r.created_at DESC,r.id DESC`;

    // One row over the page size proves another page exists without a count(*).
    const page = rows.slice(0, LEDGER_PAGE_SIZE);
    const last = rows.length > LEDGER_PAGE_SIZE ? page[page.length - 1] : undefined;
    return {
      entries: page.map(projectLedgerEntry),
      nextCursor: last ? encodeKeysetCursor({ createdAt: timestampIso(last.createdAt), id: last.id }) : null,
    };
  }

  async leaderboard(roomId: string, userId: string) {
    await this.assertMember(roomId, userId);
    // The settled count is a correlated subquery, not a join: joining every
    // ticket in the room only to COUNT(...) FILTER it back down multiplied the
    // scanned rows by each member's ticket history, and the GROUP BY existed
    // solely to undo that. `prediction_tickets_room_user_idx` serves the
    // subquery directly.
    // Grants are a correlated subquery for the same reason the settled count
    // is: ledger_entries_account_idx serves it per account, and the board is
    // capped at LEADERBOARD_MAX_ROWS accounts. Subtracting the sum keeps FR45
    // honest — the initial grant and every owner grant stay out of net points,
    // so a zero-owner-grant account ranks exactly as under the old `- 10000`.
    const rows = await this.sql<LeaderboardSourceRow[]>`
      SELECT a.user_id AS "userId",COALESCE(u.nickname,u.username_canonical) AS "displayName",a.available_points::text AS "availablePoints",
        a.frozen_points::text AS "frozenPoints",a.correction_debt::text AS "correctionDebt",
        COALESCE((SELECT SUM(e.amount) FROM ledger.entries e WHERE e.room_id=a.room_id AND e.user_id=a.user_id AND e.kind IN ('INITIAL_GRANT','OWNER_GRANT')),0)::text AS "grantedPoints",
        COALESCE((SELECT SUM(e.amount) FROM ledger.entries e WHERE e.room_id=a.room_id AND e.user_id=a.user_id AND e.kind='OWNER_GRANT'),0)::text AS "ownerGrantedPoints",
        (SELECT COUNT(*) FROM prediction.tickets t WHERE t.room_id=a.room_id AND t.user_id=a.user_id AND t.status='SETTLED')::int AS "settledTickets",
        ${avatarColumns(this.sql)}
      FROM ledger.point_accounts a JOIN identity.users u ON u.id=a.user_id
      ${avatarJoinUnlessViewerBlocked(this.sql, userId)}
      WHERE a.room_id=${roomId}
      ORDER BY (a.available_points - a.correction_debt - COALESCE((SELECT SUM(e.amount) FROM ledger.entries e WHERE e.room_id=a.room_id AND e.user_id=a.user_id AND e.kind IN ('INITIAL_GRANT','OWNER_GRANT')),0)) DESC,"displayName" LIMIT ${LEADERBOARD_MAX_ROWS}`;
    return projectLeaderboard(rows);
  }

  /**
   * Operational health: supplier budget, cache freshness, settlement backlog
   * and job counts.
   *
   * Takes the caller's already-resolved authorization rather than a user id.
   * Its one caller — the overview — reads that authorization to decide which
   * cards exist, and the by-id form used to make the identical read a second
   * time just to run this capability check. The check still runs here, so this
   * is not a "trust me" seam; and it takes the resolved authorization rather
   * than a boolean so a caller cannot simply assert "yes, allowed".
   */
  async adminStatus(authorization: OperatorAuthorization) {
    if (!authorization.capabilities.includes("OPERATIONS_HEALTH_READ")) throw new OperationError("FORBIDDEN", 403);
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
  if (row.kind === "INITIAL_GRANT" || row.kind === "OWNER_GRANT") return "GRANT";
  if (row.kind === "PREDICTION_FREEZE") return "FREEZE";
  if (row.kind === "SETTLEMENT_REVERSAL") return "REVERSAL";
  if (row.kind === "DEBT_OFFSET") return "DEBT_OFFSET";
  if (row.kind === "REFUND" || (row.kind === "SETTLEMENT" && (row.outcome === "PUSH" || row.outcome === "CANCEL"))) return "VOID";
  if (row.kind === "SETTLEMENT") return row.hasPriorSettlement ? "RE_SETTLE" : "SETTLE";
  return "RE_SETTLE";
}
function ledgerExplanation(row: Pick<LedgerSourceRow, "kind" | "outcome" | "availableDelta" | "frozenDelta" | "debtDelta" | "settlementVersion">, type: string) {
  if (type === "GRANT") return row.kind === "OWNER_GRANT" ? "房主批准的补分；单独展示，不计入预测净收益与收益排名。" : "首次加入房间的初始积分。";
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
