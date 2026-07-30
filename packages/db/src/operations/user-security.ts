import { randomUUID } from "node:crypto";
import {
  activityBucket,
  summarizeLifecycle,
  type Capability,
  type GrantableOperatorRole,
  type UserSecurityDetail,
  type UserSecurityQuery,
  type UserSecuritySummary,
} from "@pulse/domain";
import type postgres from "postgres";
import { readOperatorAuthorization, type OperatorSql } from "../identity/operator-roles.js";
import { anonymizeAccountWithin, normalizeAuditEvent, type GovernanceAuditRow } from "./moderation-privacy.js";
import { OperationError } from "./repository.js";

type DbTimestamp = Date | string;
type RosterRow = {
  id: string; username: string; nickname: string | null; status: "ACTIVE" | "DISABLED";
  lastSeenAt: DbTimestamp | null; activeSessionCount: number; roomCount: number;
  ownedRoomCount: number; restrictedRoomCount: number; openReportCount: number;
};

/**
 * User security and lifecycle console (FR81, FR82).
 *
 * Every method authorizes itself against the caller's live capabilities, on top
 * of the check the API route already performed. The SELECTs are written to expose
 * identity, security state and counts only: no password or recovery hash, no
 * session token, no access-event location, no unsealed pick, no ledger figure.
 * Nothing here writes to a balance, a prediction or the ledger (FR59), and
 * removing a public identity runs the shared anonymization routine rather than a
 * delete (FR70).
 */
export class PostgresUserSecurityRepository {
  constructor(private readonly sql: postgres.Sql, private readonly clock: { now(): Date } = { now: () => new Date() }) {}

  async listUsers(actorUserId: string, query: UserSecurityQuery): Promise<UserSecuritySummary[]> {
    await this.assertCapability(actorUserId, "USER_SECURITY_READ");
    const now = this.clock.now();
    const rows = await this.sql<RosterRow[]>`
      ${this.rosterSelect()}
      WHERE u.is_super_admin = false
        AND (${query.search} = '' OR strpos(u.username_canonical, ${query.search}) > 0)
        AND (${query.status} = 'ALL' OR u.status::text = ${query.status})
        AND COALESCE(m.room_count, 0) >= ${query.minRooms}
        AND (${query.restriction} = 'ALL'
          OR (${query.restriction} = 'COMMUNITY_RESTRICTED' AND COALESCE(o.restricted_count, 0) > 0)
          OR (${query.restriction} = 'UNRESTRICTED' AND COALESCE(o.restricted_count, 0) = 0))
        AND ${this.activityPredicate(query)}
      ORDER BY s.last_seen_at DESC NULLS LAST, u.username_canonical ASC
      LIMIT ${query.limit}`;
    return rows.map((row) => this.toSummary(row, now));
  }

  async getUser(actorUserId: string, targetUserId: string): Promise<UserSecurityDetail> {
    await this.assertCapability(actorUserId, "USER_SECURITY_READ");
    const now = this.clock.now();
    const [row] = await this.sql<Array<RosterRow & { registeredAt: DbTimestamp }>>`
      ${this.rosterSelect(true)}
      WHERE u.is_super_admin = false AND u.id = ${targetUserId}
      LIMIT 1`;
    if (!row) throw new OperationError("USER_NOT_FOUND", 404);

    const roles = await this.sql<Array<{ role: GrantableOperatorRole }>>`
      SELECT role FROM identity.operator_role_grants WHERE user_id = ${targetUserId} AND revoked_at IS NULL ORDER BY role`;
    // One account's governance timeline. Scoped to this user as the target, which
    // is why USER_SECURITY_READ is enough — the platform-wide trail stays behind
    // AUDIT_READ.
    const history = await this.sql<GovernanceAuditRow[]>`
      SELECT merged.id, COALESCE(actor.nickname, actor.username_canonical) AS actor, merged.action,
        merged.target_type, merged.target_id, merged.result, merged.metadata, merged.occurred_at
      FROM (
        SELECT e.audit_id::text AS id, e.actor_user_id, e.action, 'USER'::text AS target_type,
               e.target_user_id::text AS target_id, e.result, e.metadata, e.occurred_at
          FROM identity.admin_account_audit_events e WHERE e.target_user_id = ${targetUserId}
        UNION ALL
        SELECT a.id::text, a.actor_user_id, a.action, a.target_type, a.target_id, a.result, a.metadata, a.occurred_at
          FROM ops.audit_events a WHERE a.target_type = 'USER' AND a.target_id = ${targetUserId}
      ) merged
      LEFT JOIN identity.users actor ON actor.id = merged.actor_user_id
      ORDER BY merged.occurred_at DESC LIMIT 50`;
    const [request] = await this.sql<Array<{ status: "RECEIVED" | "COMPLETED"; requestedAt: DbTimestamp; completedAt: DbTimestamp | null }>>`
      SELECT status, requested_at AS "requestedAt", completed_at AS "completedAt" FROM ops.privacy_requests
      WHERE user_id = ${targetUserId} AND kind = 'ACCOUNT_DELETION' ORDER BY requested_at DESC LIMIT 1`;

    return {
      ...this.toSummary(row, now),
      registeredAt: timestampDate(row.registeredAt),
      operatorRoles: roles.map((entry) => entry.role),
      governanceHistory: history.map((entry) => {
        const normalized = normalizeAuditEvent(entry);
        return { id: normalized.id, action: normalized.action, actor: normalized.actor, result: normalized.result, metadata: normalized.metadata, occurredAt: new Date(normalized.occurredAt) };
      }),
      anonymization: summarizeLifecycle(request ? { status: request.status, requestedAt: timestampDate(request.requestedAt), completedAt: request.completedAt ? timestampDate(request.completedAt) : null } : null, now),
    };
  }

  /**
   * Revokes every live session of one account (FR82). Sign-in stays possible —
   * this ends the current devices, it does not disable the account. Token hashes
   * are counted, never returned.
   */
  async revokeSessions(actorUserId: string, targetUserId: string, reason: string) {
    const now = this.clock.now().toISOString(); const auditId = randomUUID();
    return this.sql.begin(async (tx) => {
      await this.assertCapability(actorUserId, "USER_SECURITY_WRITE", tx);
      const [target] = await tx<Array<{ id: string }>>`
        SELECT id FROM identity.users WHERE id=${targetUserId} AND is_super_admin = false FOR UPDATE`;
      if (!target) throw new OperationError("TARGET_NOT_MANAGEABLE", 422);
      const revoked = await tx<Array<{ userId: string }>>`
        UPDATE identity.sessions SET revoked_at=${now} WHERE user_id=${targetUserId} AND revoked_at IS NULL RETURNING user_id AS "userId"`;
      await tx`INSERT INTO identity.admin_account_audit_events (audit_id,actor_user_id,target_user_id,action,result,metadata,occurred_at)
        VALUES (${auditId},${actorUserId},${targetUserId},'SESSIONS_REVOKED','SUCCESS',${JSON.stringify({ reason, revokedSessions: revoked.length })}::text::jsonb,${now})`;
      return { targetUserId, revokedSessions: revoked.length, auditId };
    });
  }

  /** Records an anonymization request an operator received out of band (NFR22 starts the seven-day clock). */
  async fileAnonymizationRequest(actorUserId: string, targetUserId: string, reason: string) {
    const now = this.clock.now().toISOString(); const auditId = randomUUID(); const requestId = randomUUID();
    return this.sql.begin(async (tx) => {
      await this.assertCapability(actorUserId, "USER_SECURITY_WRITE", tx);
      const [target] = await tx<Array<{ id: string }>>`
        SELECT id FROM identity.users WHERE id=${targetUserId} AND is_super_admin = false AND status='ACTIVE' FOR UPDATE`;
      if (!target) throw new OperationError("TARGET_NOT_MANAGEABLE", 422);
      try {
        await tx`INSERT INTO ops.privacy_requests (id,user_id,kind,status,requested_at,requested_by,reason)
          VALUES (${requestId},${targetUserId},'ACCOUNT_DELETION','RECEIVED',${now},${actorUserId},${reason})`;
      } catch (error) {
        // A partial unique index keeps one open request per account, so two
        // operators cannot start two competing seven-day clocks.
        if (isUniqueViolation(error)) throw new OperationError("ANONYMIZATION_REQUEST_EXISTS", 409);
        throw error;
      }
      await tx`INSERT INTO ops.audit_events (id,actor_user_id,action,target_type,target_id,result,metadata,occurred_at)
        VALUES (${auditId},${actorUserId},'ACCOUNT_ANONYMIZATION_REQUESTED','USER',${targetUserId},'SUCCESS',${JSON.stringify({ privacyRequestId: requestId, reason })}::text::jsonb,${now})`;
      return { targetUserId, privacyRequestId: requestId, status: "RECEIVED" as const, auditId };
    });
  }

  /** Completes an open request by running the shared anonymization routine (FR70). Never a hard delete. */
  async completeAnonymizationRequest(actorUserId: string, targetUserId: string, requestId: string, reason: string) {
    const now = this.clock.now().toISOString(); const auditId = randomUUID();
    return this.sql.begin(async (tx) => {
      await this.assertCapability(actorUserId, "USER_SECURITY_WRITE", tx);
      const [request] = await tx<Array<{ id: string }>>`
        SELECT id FROM ops.privacy_requests
        WHERE id=${requestId} AND user_id=${targetUserId} AND kind='ACCOUNT_DELETION' AND status='RECEIVED' FOR UPDATE`;
      if (!request) throw new OperationError("ANONYMIZATION_REQUEST_NOT_OPEN", 409);
      await anonymizeAccountWithin(tx, { userId: targetUserId, actorUserId, auditId, privacyRequestId: requestId, occurredAt: now, reason });
      await tx`UPDATE ops.privacy_requests SET status='COMPLETED',completed_at=${now},handled_by=${actorUserId} WHERE id=${requestId}`;
      return { targetUserId, privacyRequestId: requestId, status: "COMPLETED" as const, auditId };
    });
  }

  /** The open-request queue with its seven-day service level (NFR22). */
  async listAnonymizationRequests(actorUserId: string) {
    await this.assertCapability(actorUserId, "USER_SECURITY_READ");
    const now = this.clock.now();
    const rows = await this.sql<Array<{ id: string; userId: string; username: string; status: "RECEIVED"; requestedAt: DbTimestamp; reason: string | null }>>`
      SELECT p.id, p.user_id AS "userId", u.username_canonical AS username, p.status, p.requested_at AS "requestedAt", p.reason
      FROM ops.privacy_requests p JOIN identity.users u ON u.id = p.user_id
      WHERE p.status = 'RECEIVED' AND p.kind = 'ACCOUNT_DELETION'
      ORDER BY p.requested_at ASC LIMIT 200`;
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      username: row.username,
      reason: row.reason,
      ...summarizeLifecycle({ status: row.status, requestedAt: timestampDate(row.requestedAt), completedAt: null }, now)!,
    }));
  }

  /** Shared roster projection. Only counts and timestamps leave the database. */
  private rosterSelect(includeRegistration = false) {
    return this.sql`
      SELECT u.id, u.username_canonical AS username, u.nickname, u.status,
        s.last_seen_at AS "lastSeenAt",
        COALESCE(s.active_sessions, 0)::int AS "activeSessionCount",
        COALESCE(m.room_count, 0)::int AS "roomCount",
        COALESCE(o.owned_count, 0)::int AS "ownedRoomCount",
        COALESCE(o.restricted_count, 0)::int AS "restrictedRoomCount",
        COALESCE(r.open_reports, 0)::int AS "openReportCount"
        ${includeRegistration ? this.sql`, u.created_at AS "registeredAt"` : this.sql``}
      FROM identity.users u
      LEFT JOIN (
        SELECT user_id, MAX(last_seen_at) AS last_seen_at,
          COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now()) AS active_sessions
        FROM identity.sessions GROUP BY user_id
      ) s ON s.user_id = u.id
      LEFT JOIN (SELECT user_id, COUNT(*) AS room_count FROM room.members GROUP BY user_id) m ON m.user_id = u.id
      LEFT JOIN (
        SELECT created_by, COUNT(*) AS owned_count,
          COUNT(*) FILTER (WHERE status = 'RESTRICTED') AS restricted_count
        FROM room.rooms GROUP BY created_by
      ) o ON o.created_by = u.id
      LEFT JOIN (
        SELECT rr.created_by, COUNT(*) AS open_reports
        FROM room.reports rp JOIN room.rooms rr ON rr.id = rp.room_id
        WHERE rp.status IN ('OPEN','ASSIGNED') GROUP BY rr.created_by
      ) r ON r.created_by = u.id`;
  }

  // Bounds match domain activityBucket exactly, so the filter and the badge the
  // operator sees can never disagree.
  private activityPredicate(query: UserSecurityQuery) {
    switch (query.activity) {
      case "LAST_24H": return this.sql`s.last_seen_at >= now() - interval '1 day'`;
      case "LAST_7D": return this.sql`s.last_seen_at >= now() - interval '7 days'`;
      case "LAST_30D": return this.sql`s.last_seen_at >= now() - interval '30 days'`;
      case "DORMANT_30D": return this.sql`(s.last_seen_at IS NOT NULL AND s.last_seen_at < now() - interval '30 days')`;
      case "NEVER": return this.sql`s.last_seen_at IS NULL`;
      default: return this.sql`true`;
    }
  }

  private toSummary(row: RosterRow, now: Date): UserSecuritySummary {
    const lastSeenAt = row.lastSeenAt ? timestampDate(row.lastSeenAt) : null;
    return {
      id: row.id,
      username: row.username,
      nickname: row.nickname,
      status: row.status,
      lastSeenAt,
      activityBucket: activityBucket(lastSeenAt, now),
      activeSessionCount: Number(row.activeSessionCount),
      roomCount: Number(row.roomCount),
      ownedRoomCount: Number(row.ownedRoomCount),
      restrictedRoomCount: Number(row.restrictedRoomCount),
      openReportCount: Number(row.openReportCount),
      // A governance action has actually landed on a room this account owns.
      // Routine closure of a settled room is deliberately not counted.
      communityRestricted: Number(row.restrictedRoomCount) > 0,
    };
  }

  private async assertCapability(userId: string, capability: Capability, sql: OperatorSql = this.sql) {
    const authorization = await readOperatorAuthorization(sql, userId);
    if (!authorization.capabilities.includes(capability)) throw new OperationError("FORBIDDEN", 403);
  }
}

function timestampDate(value: DbTimestamp) { return value instanceof Date ? value : new Date(value); }

function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current !== null && current !== undefined && depth < 5; depth++) {
    if (typeof current !== "object") break;
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (candidate.code === "23505") return true;
    if (typeof candidate.message === "string" && candidate.message.includes("duplicate key value violates unique constraint")) return true;
    current = candidate.cause;
  }
  return false;
}
