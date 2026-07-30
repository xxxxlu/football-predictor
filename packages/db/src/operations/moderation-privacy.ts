import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { REDACTION_MARKER, resolveAuditActions, type AuditQuery, type Capability } from "@pulse/domain";
import { readOperatorAuthorization, type OperatorSql } from "../identity/operator-roles.js";
import { OperationError } from "./repository.js";

export type RoomModerationAction = "RESTRICT" | "CLOSE" | "RESTORE";
export type ModeratedRoomStatus = "ACTIVE" | "RESTRICTED" | "CLOSED";
type DbTimestamp = Date | string;

export function roomAllowsPredictions(status: ModeratedRoomStatus) { return status === "ACTIVE"; }
export function roomAllowsMemberRead(_status: ModeratedRoomStatus) { return true; }
export function roomTransition(action: RoomModerationAction): ModeratedRoomStatus {
  return action === "RESTRICT" ? "RESTRICTED" : action === "CLOSE" ? "CLOSED" : "ACTIVE";
}
export function anonymousDisplayName(userId: string) { return `已删除用户-${userId.slice(0, 8)}`; }

/**
 * Removes an account's public identity while keeping the minimum ledger record
 * intact (FR70). This is the ONLY anonymization implementation: the self-service
 * flow below and the operator-handled request in user-security.ts both call it,
 * so the two paths can never drift apart.
 *
 * It is not a delete. Rows stay, joins keep working, and the ledger stays
 * verifiable — the identifying columns are overwritten with opaque values and
 * every live session is revoked. A super-admin can never be anonymized.
 */
export async function anonymizeAccountWithin(tx: OperatorSql, input: { userId: string; actorUserId: string; auditId: string; privacyRequestId: string; occurredAt: string; reason?: string }) {
  const [account] = await tx<Array<{ superAdmin: boolean; username: string }>>`
    SELECT is_super_admin AS "superAdmin",username_canonical AS username FROM identity.users WHERE id=${input.userId} AND status='ACTIVE' FOR UPDATE`;
  if (!account) throw new OperationError("TARGET_NOT_ANONYMIZABLE", 422);
  if (account.superAdmin) throw new OperationError("FORBIDDEN", 403);

  const opaque = createHash("sha256").update(`${input.userId}:${input.privacyRequestId}`).digest("hex");
  const anonymizedName = anonymousDisplayName(input.userId);
  await tx`UPDATE identity.users SET username_canonical=${`deleted-${input.userId}`},nickname=${anonymizedName},password_hash=${opaque},recovery_code_hash=${opaque},status='DISABLED',updated_at=${input.occurredAt} WHERE id=${input.userId}`;
  await tx`UPDATE identity.auth_attempts SET account_key=${`deleted:${opaque}`} WHERE account_key=${account.username}`;
  await tx`UPDATE identity.security_events SET account_key=${`deleted:${opaque}`} WHERE account_key=${account.username}`;
  await tx`UPDATE identity.sessions SET revoked_at=${input.occurredAt} WHERE user_id=${input.userId} AND revoked_at IS NULL`;
  await tx`INSERT INTO ops.audit_events (id,actor_user_id,action,target_type,target_id,result,metadata,occurred_at)
    VALUES (${input.auditId},${input.actorUserId},'ACCOUNT_ANONYMIZED','USER',${input.userId},'SUCCESS',${JSON.stringify({ privacyRequestId: input.privacyRequestId, ...(input.reason ? { reason: input.reason } : {}) })}::text::jsonb,${input.occurredAt})`;
  return { anonymizedName };
}

/**
 * Defensive secret redaction for governance audit metadata. Even though writers
 * are expected to persist only non-sensitive fields, this guarantees the admin
 * audit response never surfaces a token, password, recovery code, invite secret
 * or proof — satisfying FR54/NFR41 regardless of what a future writer stores.
 *
 * Precise location is on the same list (AC4 of Story 11.4 names it). Location keys
 * are matched as whole words, not as substrings: `ip` occurs inside `description`
 * and `recipient`, and redacting an operator's own written reason would be worse
 * than the leak it was guarding against. Keys are compared in snake_case so a
 * camelCase `reporterIpAddress` and a snake_case `reporter_ip_address` are the
 * same key.
 */
const SENSITIVE_AUDIT_KEY = /(token|password|secret|recovery|invite|proof|hash|credential|otp|apikey|api_key)/i;
const LOCATION_AUDIT_KEY = /(^|_)(ip|address|lat|latitude|lng|longitude|geo|coord|coords|location|placename)(_|$)/;

function isSensitiveAuditKey(key: string): boolean {
  if (SENSITIVE_AUDIT_KEY.test(key)) return true;
  const snake = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return LOCATION_AUDIT_KEY.test(snake);
}
export function redactAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditMetadata);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSensitiveAuditKey(key) ? REDACTION_MARKER : redactAuditMetadata(entry);
    }
    return output;
  }
  return value;
}

/**
 * Audit metadata must be written as `${JSON.stringify(value)}::text::jsonb`.
 * With a bare `::jsonb` cast, postgres.js infers a json parameter and encodes
 * the string a second time, so the column ends up holding a jsonb *string*
 * instead of an object. Rows written before that was fixed are still stored that
 * way, so the reader below unwraps one level of encoding rather than showing an
 * operator a blob of escaped JSON.
 */
function decodeAuditMetadata(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return value;
  try { return JSON.parse(text); } catch { return value; }
}

export type GovernanceAuditRow = { id: string; actor: string | null; action: string; target_type: string; target_id: string; result: string; metadata: unknown; occurred_at: DbTimestamp };
/** Maps a merged audit row (from any of the three audit tables) into the stable API shape with redacted metadata and an ISO timestamp. */
export function normalizeAuditEvent(row: GovernanceAuditRow) {
  return {
    id: row.id,
    actor: row.actor ?? null,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    result: row.result,
    metadata: redactAuditMetadata(decodeAuditMetadata(row.metadata) ?? {}),
    occurredAt: timestampIso(row.occurred_at),
  };
}

/**
 * The one implementation of the merged governance trail (FR60, Story 11.4).
 *
 * Governance history lives in three tables: ops.audit_events (reports, room
 * moderation, account anonymization, task retries),
 * identity.admin_account_audit_events (account disable/restore, operator duty
 * grant/revoke) and room.audit_events (room create/join/invite reset). They are
 * unioned before filtering so ordering, limiting and redaction are identical no
 * matter which surface asked — the unified audit workbench and the legacy
 * unfiltered list are the same read with different filters.
 *
 * Filters are built as fragments rather than inline `OR` guards: postgres.js
 * cannot infer an element type for an empty array, so an unfiltered action list
 * has to disappear from the SQL entirely instead of binding `= ANY('{}')`.
 *
 * Timestamps cross the wire as ISO strings, never Date instances — the Next.js
 * runtime instruments Date, which defeats postgres.js's instanceof-based type
 * inference and throws ERR_INVALID_ARG_TYPE.
 */
export async function listGovernanceAudit(sql: postgres.Sql, actorUserId: string, query: AuditQuery) {
  // The gate lives with the read rather than at the one call site that exists
  // today: this function is the whole platform-wide trail, so any future importer
  // has to arrive holding AUDIT_READ instead of remembering to check first.
  const authorization = await readOperatorAuthorization(sql, actorUserId);
  if (!authorization.capabilities.includes("AUDIT_READ")) throw new OperationError("FORBIDDEN", 403);
  const actions = resolveAuditActions(query);
  const actionPredicate = actions.length === 0 ? sql`true` : sql`merged.action = ANY(${actions as string[]})`;
  const actorPredicate = query.actor === ""
    ? sql`true`
    : sql`strpos(COALESCE(u.username_canonical, ''), ${query.actor}) > 0`;
  const targetTypePredicate = query.targetType === "ALL" ? sql`true` : sql`merged.target_type = ${query.targetType}`;
  const targetIdPredicate = query.targetId === "" ? sql`true` : sql`merged.target_id = ${query.targetId}`;
  const resultPredicate = query.result === "ALL" ? sql`true` : sql`merged.result = ${query.result}`;
  const fromPredicate = query.from === null ? sql`true` : sql`merged.occurred_at >= ${query.from.toISOString()}::timestamptz`;
  // Exclusive upper bound: `occurred_at` is microsecond precision, so an
  // inclusive bound built from a millisecond literal would drop the last
  // sub-millisecond of the range an operator asked for.
  const toPredicate = query.to === null ? sql`true` : sql`merged.occurred_at < ${query.to.toISOString()}::timestamptz`;
  // NFR37: the correlation id is the audit id itself, so a report timeline or a
  // member notice can hand an operator one identifier that resolves to one entry.
  const correlationPredicate = query.correlationId === "" ? sql`true` : sql`merged.id = ${query.correlationId}`;

  const rows = await sql<GovernanceAuditRow[]>`
    SELECT merged.id, COALESCE(u.nickname, u.username_canonical) AS actor, merged.action,
      merged.target_type, merged.target_id, merged.result, merged.metadata, merged.occurred_at
    FROM (
      SELECT a.id::text AS id, a.actor_user_id, a.action, a.target_type, a.target_id, a.result, a.metadata, a.occurred_at
        FROM ops.audit_events a
      UNION ALL
      SELECT e.audit_id::text, e.actor_user_id, e.action, 'USER'::text, e.target_user_id::text, e.result, e.metadata, e.occurred_at
        FROM identity.admin_account_audit_events e
      UNION ALL
      SELECT r.audit_id::text, r.actor_user_id, r.action, 'ROOM'::text, r.room_id::text, r.result, '{}'::jsonb, r.occurred_at
        FROM room.audit_events r
    ) merged
    LEFT JOIN identity.users u ON u.id = merged.actor_user_id
    WHERE ${actionPredicate} AND ${actorPredicate} AND ${targetTypePredicate} AND ${targetIdPredicate}
      AND ${resultPredicate} AND ${fromPredicate} AND ${toPredicate} AND ${correlationPredicate}
    ORDER BY merged.occurred_at DESC, merged.id ASC
    LIMIT ${query.limit}`;
  return rows.map(normalizeAuditEvent);
}

export class PostgresModerationPrivacyRepository {
  constructor(private readonly sql: postgres.Sql, private readonly clock: { now(): Date } = { now: () => new Date() }) {}

  async reportRoom(roomId: string, reporterUserId: string, reason: string) {
    const reportId = randomUUID(); const auditId = randomUUID(); const now = this.clock.now().toISOString();
    const rows = await this.sql.begin(async (tx) => {
      const inserted = await tx<Array<{ reportId: string; status: "OPEN" }>>`
        INSERT INTO room.reports (id,room_id,reporter_user_id,reason,status,created_at,updated_at)
        SELECT ${reportId},r.id,${reporterUserId},${reason},'OPEN',${now},${now}
        FROM room.rooms r JOIN room.members m ON m.room_id=r.id
        WHERE r.id=${roomId} AND m.user_id=${reporterUserId} AND r.status<>'CLOSED'
        RETURNING id AS "reportId",status`;
      if (!inserted[0]) throw new OperationError("ROOM_NOT_FOUND", 404);
      await tx`INSERT INTO ops.audit_events (id,actor_user_id,action,target_type,target_id,result,metadata,occurred_at)
        VALUES (${auditId},${reporterUserId},'ROOM_REPORTED','ROOM',${roomId},'SUCCESS',${JSON.stringify({ reportId })}::text::jsonb,${now})`;
      return inserted;
    });
    return rows[0];
  }

  async listReports(adminUserId: string) {
    // Room-side duty, not the inbox's shared ROOM_REPORT_READ key: see the route.
    await this.assertCapability(adminUserId, "ROOM_GOVERNANCE_READ");
    const rows = await this.sql<Array<{ reportId: string; roomId: string; roomName: string; roomStatus: ModeratedRoomStatus; reporter: string; reason: string; status: string; createdAt: DbTimestamp; resolvedAt: DbTimestamp | null }>>`
      SELECT rp.id AS "reportId",rp.room_id AS "roomId",r.name AS "roomName",r.status AS "roomStatus",
        COALESCE(u.nickname,u.username_canonical) AS reporter,rp.reason,rp.status,rp.created_at AS "createdAt",rp.resolved_at AS "resolvedAt"
      FROM room.reports rp JOIN room.rooms r ON r.id=rp.room_id JOIN identity.users u ON u.id=rp.reporter_user_id
      WHERE rp.kind='ROOM'
      ORDER BY CASE WHEN rp.status IN ('OPEN','ASSIGNED') THEN 0 ELSE 1 END,rp.created_at DESC LIMIT 200`;
    return rows.map((row) => ({ ...row, createdAt: timestampIso(row.createdAt), resolvedAt: row.resolvedAt ? timestampIso(row.resolvedAt) : null }));
  }

  async listRooms(adminUserId: string) {
    await this.assertCapability(adminUserId, "ROOM_GOVERNANCE_READ");
    const rows = await this.sql<Array<{ roomId: string; name: string; status: ModeratedRoomStatus; memberCount: number; preMatchStakeVisible: boolean; postMatchTicketVisible: boolean }>>`
      SELECT r.id AS "roomId",r.name,r.status,COUNT(m.user_id)::int AS "memberCount",
        r.pre_match_stake_visible AS "preMatchStakeVisible",r.post_match_ticket_visible AS "postMatchTicketVisible"
      FROM room.rooms r LEFT JOIN room.members m ON m.room_id=r.id
      GROUP BY r.id,r.name,r.status,r.pre_match_stake_visible,r.post_match_ticket_visible,r.created_at
      ORDER BY r.created_at DESC LIMIT 500`;
    return rows;
  }

  async updatePreMatchStakeVisibility(adminUserId: string, roomId: string, visible: boolean) {
    const auditId = randomUUID(); const now = this.clock.now().toISOString();
    return this.sql.begin(async (tx) => {
      await this.assertCapability(adminUserId, "ROOM_GOVERNANCE_WRITE", tx);
      const [room] = await tx<Array<{ previousValue: boolean }>>`SELECT pre_match_stake_visible AS "previousValue" FROM room.rooms WHERE id=${roomId} FOR UPDATE`;
      if (!room) throw new OperationError("ROOM_NOT_FOUND", 404);
      const [updated] = await tx<Array<{ roomId: string; preMatchStakeVisible: boolean }>>`
        UPDATE room.rooms SET pre_match_stake_visible=${visible},updated_at=${now} WHERE id=${roomId}
        RETURNING id AS "roomId",pre_match_stake_visible AS "preMatchStakeVisible"`;
      await tx`INSERT INTO ops.audit_events (id,actor_user_id,action,target_type,target_id,result,metadata,occurred_at)
        VALUES (${auditId},${adminUserId},'ROOM_PRE_MATCH_STAKE_VISIBILITY_UPDATED','ROOM',${roomId},'SUCCESS',${JSON.stringify({ previousValue: room.previousValue, newValue: visible })}::text::jsonb,${now})`;
      return updated;
    });
  }

  // The audit trail is read through PostgresOperationsOverviewRepository (Story
  // 11.4), which owns the AUDIT_READ gate and the filters. `listGovernanceAudit`
  // below stays here beside the redaction helpers it depends on.

  async moderateRoom(adminUserId: string, roomId: string, action: RoomModerationAction, reason: string) {
    const status = roomTransition(action); const auditId = randomUUID(); const now = this.clock.now().toISOString();
    return this.sql.begin(async (tx) => {
      await this.assertCapability(adminUserId, "ROOM_GOVERNANCE_WRITE", tx);
      const updated = await tx<Array<{ roomId: string; status: ModeratedRoomStatus }>>`
        UPDATE room.rooms SET status=${status},updated_at=${now} WHERE id=${roomId} RETURNING id AS "roomId",status`;
      if (!updated[0]) throw new OperationError("ROOM_NOT_FOUND", 404);
      // Same vocabulary as the governance inbox (Story 11.3): one decision closes
      // every open filing against the room, including the ones already claimed.
      const resolved = await tx<Array<{ reportId: string }>>`
        UPDATE room.reports SET status='RESOLVED',resolved_by=${adminUserId},resolution=${`${action}_ROOM`},
        resolution_note=${reason},resolved_at=${now},updated_at=${now}
        WHERE room_id=${roomId} AND kind='ROOM' AND status IN ('OPEN','ASSIGNED')
        RETURNING id AS "reportId"`;
      await tx`INSERT INTO ops.audit_events (id,actor_user_id,action,target_type,target_id,result,metadata,occurred_at)
        VALUES (${auditId},${adminUserId},${`ROOM_${action}`},'ROOM',${roomId},'SUCCESS',${JSON.stringify({ reason, status, resolvedReports: resolved.length })}::text::jsonb,${now})`;
      // A filing closed by a decision taken from the room list needs an entry of
      // its own, the same as one closed from the governance inbox. The room-scoped
      // row above is not reachable from a report's timeline, so without these the
      // report would show as resolved with nothing recording what resolved it.
      for (const report of resolved) {
        await tx`INSERT INTO ops.audit_events (id,actor_user_id,action,target_type,target_id,result,metadata,occurred_at)
          VALUES (${randomUUID()},${adminUserId},'REPORT_RESOLVED','REPORT',${report.reportId},'SUCCESS',
          ${JSON.stringify({ reportId: report.reportId, disposition: `${action}_ROOM`, reason, resolutionAuditId: auditId })}::text::jsonb,${now})`;
      }
      return updated[0];
    });
  }

  /** Self-service account deletion: the holder raises the request and the system
   *  completes the anonymization in the same transaction (FR70). */
  async deleteAccount(userId: string) {
    const now = this.clock.now().toISOString(); const requestId = randomUUID(); const auditId = randomUUID();
    return this.sql.begin(async (tx) => {
      // The holder must be the one asking, so a missing account is an auth failure
      // here rather than the "not anonymizable" the shared routine would report.
      const [self] = await tx<Array<{ id: string }>>`SELECT id FROM identity.users WHERE id=${userId} AND status='ACTIVE' LIMIT 1`;
      if (!self) throw new OperationError("UNAUTHENTICATED", 401);
      await anonymizeAccountWithin(tx, { userId, actorUserId: userId, auditId, privacyRequestId: requestId, occurredAt: now });
      await tx`INSERT INTO ops.privacy_requests (id,user_id,kind,status,requested_at,completed_at) VALUES (${requestId},${userId},'ACCOUNT_DELETION','COMPLETED',${now},${now})`;
      return { deleted: true as const, privacyRequestId: requestId };
    });
  }

  /**
   * Repository-side capability gate. The API layer checks the same capability
   * first; this is the second, independent check so no future caller can reach a
   * governance read or write without the duty that covers it (FR81).
   */
  private async assertCapability(userId: string, capability: Capability, sql: OperatorSql = this.sql) {
    const authorization = await readOperatorAuthorization(sql, userId);
    if (!authorization.capabilities.includes(capability)) throw new OperationError("FORBIDDEN", 403);
  }
}

function timestampIso(value: DbTimestamp) { return (value instanceof Date ? value : new Date(value)).toISOString(); }
