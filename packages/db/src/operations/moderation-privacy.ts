import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
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
        VALUES (${auditId},${reporterUserId},'ROOM_REPORTED','ROOM',${roomId},'SUCCESS',${JSON.stringify({ reportId })}::jsonb,${now})`;
      return inserted;
    });
    return rows[0];
  }

  async listReports(adminUserId: string) {
    await this.assertSuperAdmin(adminUserId);
    const rows = await this.sql<Array<{ reportId: string; roomId: string; roomName: string; roomStatus: ModeratedRoomStatus; reporter: string; reason: string; status: string; createdAt: DbTimestamp; resolvedAt: DbTimestamp | null }>>`
      SELECT rp.id AS "reportId",rp.room_id AS "roomId",r.name AS "roomName",r.status AS "roomStatus",
        COALESCE(u.nickname,u.username_canonical) AS reporter,rp.reason,rp.status,rp.created_at AS "createdAt",rp.resolved_at AS "resolvedAt"
      FROM room.reports rp JOIN room.rooms r ON r.id=rp.room_id JOIN identity.users u ON u.id=rp.reporter_user_id
      ORDER BY CASE WHEN rp.status='OPEN' THEN 0 ELSE 1 END,rp.created_at DESC LIMIT 200`;
    return rows.map((row) => ({ ...row, createdAt: timestampIso(row.createdAt), resolvedAt: row.resolvedAt ? timestampIso(row.resolvedAt) : null }));
  }

  async listAudit(adminUserId: string) {
    await this.assertSuperAdmin(adminUserId);
    const rows = await this.sql<Array<{ id: string; actor: string | null; action: string; targetType: string; targetId: string; result: string; metadata: unknown; occurredAt: DbTimestamp }>>`
      SELECT a.id,COALESCE(u.nickname,u.username_canonical) AS actor,a.action,a.target_type AS "targetType",a.target_id AS "targetId",
        a.result,a.metadata,a.occurred_at AS "occurredAt" FROM ops.audit_events a
      LEFT JOIN identity.users u ON u.id=a.actor_user_id ORDER BY a.occurred_at DESC LIMIT 200`;
    return rows.map((row) => ({ ...row, occurredAt: timestampIso(row.occurredAt) }));
  }

  async moderateRoom(adminUserId: string, roomId: string, action: RoomModerationAction, reason: string) {
    const status = roomTransition(action); const auditId = randomUUID(); const now = this.clock.now().toISOString();
    return this.sql.begin(async (tx) => {
      const [admin] = await tx<Array<{ allowed: boolean }>>`SELECT is_super_admin AS allowed FROM identity.users WHERE id=${adminUserId} AND status='ACTIVE' LIMIT 1`;
      if (!admin?.allowed) throw new OperationError("FORBIDDEN", 403);
      const updated = await tx<Array<{ roomId: string; status: ModeratedRoomStatus }>>`
        UPDATE room.rooms SET status=${status},updated_at=${now} WHERE id=${roomId} RETURNING id AS "roomId",status`;
      if (!updated[0]) throw new OperationError("ROOM_NOT_FOUND", 404);
      await tx`UPDATE room.reports SET status='RESOLVED',resolved_by=${adminUserId},resolution=${action},resolved_at=${now},updated_at=${now}
        WHERE room_id=${roomId} AND status='OPEN'`;
      await tx`INSERT INTO ops.audit_events (id,actor_user_id,action,target_type,target_id,result,metadata,occurred_at)
        VALUES (${auditId},${adminUserId},${`ROOM_${action}`},'ROOM',${roomId},'SUCCESS',${JSON.stringify({ reason, status })}::jsonb,${now})`;
      return updated[0];
    });
  }

  async deleteAccount(userId: string) {
    const now = this.clock.now().toISOString(); const requestId = randomUUID(); const auditId = randomUUID();
    const anonymizedName = anonymousDisplayName(userId);
    const opaque = createHash("sha256").update(`${userId}:${requestId}`).digest("hex");
    return this.sql.begin(async (tx) => {
      const [account] = await tx<Array<{ superAdmin: boolean; username: string }>>`SELECT is_super_admin AS "superAdmin",username_canonical AS username FROM identity.users WHERE id=${userId} AND status='ACTIVE' FOR UPDATE`;
      if (!account) throw new OperationError("UNAUTHENTICATED", 401);
      if (account.superAdmin) throw new OperationError("FORBIDDEN", 403);
      await tx`UPDATE identity.users SET username_canonical=${`deleted-${userId}`},nickname=${anonymizedName},password_hash=${opaque},recovery_code_hash=${opaque},status='DISABLED',updated_at=${now} WHERE id=${userId}`;
      await tx`UPDATE identity.auth_attempts SET account_key=${`deleted:${opaque}`} WHERE account_key=${account.username}`;
      await tx`UPDATE identity.security_events SET account_key=${`deleted:${opaque}`} WHERE account_key=${account.username}`;
      await tx`UPDATE identity.sessions SET revoked_at=${now} WHERE user_id=${userId} AND revoked_at IS NULL`;
      await tx`INSERT INTO ops.privacy_requests (id,user_id,kind,status,requested_at,completed_at) VALUES (${requestId},${userId},'ACCOUNT_DELETION','COMPLETED',${now},${now})`;
      await tx`INSERT INTO ops.audit_events (id,actor_user_id,action,target_type,target_id,result,metadata,occurred_at)
        VALUES (${auditId},${userId},'ACCOUNT_ANONYMIZED','USER',${userId},'SUCCESS',${JSON.stringify({ privacyRequestId: requestId })}::jsonb,${now})`;
      return { deleted: true as const, privacyRequestId: requestId };
    });
  }

  private async assertSuperAdmin(userId: string) {
    const [admin] = await this.sql<Array<{ allowed: boolean }>>`SELECT is_super_admin AS allowed FROM identity.users WHERE id=${userId} AND status='ACTIVE' LIMIT 1`;
    if (!admin?.allowed) throw new OperationError("FORBIDDEN", 403);
  }
}

function timestampIso(value: DbTimestamp) { return (value instanceof Date ? value : new Date(value)).toISOString(); }
