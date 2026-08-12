import type postgres from "postgres";

import {
  grantRoomStatusRefusal,
  RoomError,
  ruleOnGrantDecision,
  type GrantRequestRecord,
  type RoomGrantRepository,
  type RoomStatus,
} from "@pulse/domain";

import { isUniqueViolation } from "../identity/repository.js";

/**
 * Room grant requests (Story 8.1, FR43-FR45).
 *
 * Authorization is inlined into SQL, never compared in JS (the room-chat
 * shape): a non-member's read or write matches zero rows and is answered
 * null → ROOM_NOT_FOUND / GRANT_NOT_FOUND, indistinguishable from a room or
 * request that does not exist. The owner gate joins `role='OWNER'` — a
 * member's attempt to decide answers 404, never 403, because the decision
 * endpoint must not confirm its own existence to non-owners.
 *
 * The approve path is one transaction: request row locked FOR UPDATE →
 * ruleOnGrantDecision → OWNER_GRANT ledger entry (idempotencyKey
 * `owner-grant:<requestId>` — the unique constraint is the final arbiter) →
 * account increase → request closure → audit event. No query here touches
 * prediction or supplier relations.
 */
export type GrantSql = postgres.Sql;

/** Timestamps bind as ISO strings: Next.js instruments the global Date, defeating postgres.js's instanceof inference. */
type GrantRow = {
  id: string; roomId: string; requesterUserId: string; requesterDisplayName: string;
  note: string | null; status: GrantRequestRecord["status"]; requestedAt: Date | string;
  decidedAt: Date | string | null; approvedAmount: string | null; decisionNote: string | null;
};

const GRANT_PROJECTION = (sql: GrantSql) => sql`
  g.id, g.room_id AS "roomId", g.requester_user_id AS "requesterUserId",
  COALESCE(u.nickname, u.username_canonical) AS "requesterDisplayName",
  g.note, g.status, g.requested_at AS "requestedAt", g.decided_at AS "decidedAt",
  g.approved_amount::text AS "approvedAmount", g.decision_note AS "decisionNote"`;

/** Newest first. Rooms are friend-sized; the cap is a runaway guard, not paging. */
const GRANT_LIST_MAX_ROWS = 200;

function project(row: GrantRow): GrantRequestRecord {
  return {
    id: row.id,
    roomId: row.roomId,
    requester: { userId: row.requesterUserId, displayName: row.requesterDisplayName },
    note: row.note,
    status: row.status,
    requestedAt: iso(row.requestedAt),
    decidedAt: row.decidedAt === null ? null : iso(row.decidedAt),
    approvedAmount: row.approvedAmount,
    decisionNote: row.decisionNote,
  };
}

function iso(value: Date | string) { return (value instanceof Date ? value : new Date(value)).toISOString(); }

export function createRoomGrantRepository(sql: GrantSql): RoomGrantRepository {
  async function readGrant(tx: postgres.ISql, grantId: string): Promise<GrantRequestRecord | null> {
    const [row] = await tx<GrantRow[]>`
      SELECT ${GRANT_PROJECTION(sql)} FROM room.grant_requests g
      JOIN identity.users u ON u.id = g.requester_user_id
      WHERE g.id = ${grantId} LIMIT 1`;
    return row ? project(row) : null;
  }

  async function runDecision(input: Parameters<RoomGrantRepository["decideGrant"]>[0]) {
    return sql.begin(async (tx) => {
      // One statement carries every authorization fact: the request exists,
      // belongs to this room, and the caller owns that room. FOR UPDATE OF g
      // serializes concurrent decisions on the same request.
      const [current] = await tx<Array<{ id: string; status: GrantRequestRecord["status"]; approvedAmount: string | null; requesterUserId: string; roomStatus: RoomStatus }>>`
        SELECT g.id, g.status, g.approved_amount::text AS "approvedAmount", g.requester_user_id AS "requesterUserId", r.status AS "roomStatus"
        FROM room.grant_requests g
        JOIN room.rooms r ON r.id = g.room_id
        JOIN room.members o ON o.room_id = r.id AND o.user_id = ${input.ownerId} AND o.role = 'OWNER'
        WHERE g.id = ${input.grantId} AND g.room_id = ${input.roomId}
        FOR UPDATE OF g LIMIT 1`;
      if (!current) return null;
      const ruling = ruleOnGrantDecision({ current: { status: current.status, approvedAmount: current.approvedAmount }, action: input.action, amount: input.amount });
      if (ruling.kind === "REFUSE") throw ruling.error;
      if (ruling.kind === "REPLAY") {
        const request = await readGrant(tx, input.grantId);
        if (!request) throw new Error("decided grant row disappeared under its own lock");
        return { request, replayed: true };
      }
      const refusal = grantRoomStatusRefusal(current.roomStatus);
      if (refusal) throw refusal;
      const nowIso = input.now.toISOString();
      if (input.action === "APPROVE") {
        const amount = input.amount;
        if (amount === null) throw new RoomError("GRANT_AMOUNT_INVALID", 422);
        // Account row locked before the balance write (architecture L235);
        // the composite FK guarantees the account exists for any member. The
        // OWNER_GRANT unique key needs no in-transaction catch: any collision
        // aborts this transaction and decideGrant's outer recovery replays.
        await tx`SELECT 1 FROM ledger.point_accounts WHERE room_id = ${input.roomId} AND user_id = ${current.requesterUserId} FOR UPDATE`;
        await tx`INSERT INTO ledger.entries (id, room_id, user_id, kind, amount, available_delta_points, idempotency_key, audit_id, created_at)
          VALUES (${input.ledgerId}, ${input.roomId}, ${current.requesterUserId}, 'OWNER_GRANT', ${amount}, ${amount}, ${`owner-grant:${input.grantId}`}, ${input.auditId}, ${nowIso}::timestamptz)`;
        await tx`UPDATE ledger.point_accounts SET available_points = available_points + ${amount}, updated_at = ${nowIso}::timestamptz
          WHERE room_id = ${input.roomId} AND user_id = ${current.requesterUserId}`;
        await tx`UPDATE room.grant_requests SET status = 'APPROVED', decided_by = ${input.ownerId}, decided_at = ${nowIso}::timestamptz,
          approved_amount = ${amount}, decision_note = ${input.note}, ledger_id = ${input.ledgerId}
          WHERE id = ${input.grantId}`;
        await tx`INSERT INTO room.audit_events (audit_id, actor_user_id, room_id, action, result, occurred_at)
          VALUES (${input.auditId}, ${input.ownerId}, ${input.roomId}, 'GRANT_APPROVED', 'SUCCESS', ${nowIso}::timestamptz)`;
      } else {
        await tx`UPDATE room.grant_requests SET status = 'DENIED', decided_by = ${input.ownerId}, decided_at = ${nowIso}::timestamptz,
          decision_note = ${input.note}
          WHERE id = ${input.grantId}`;
        await tx`INSERT INTO room.audit_events (audit_id, actor_user_id, room_id, action, result, occurred_at)
          VALUES (${input.auditId}, ${input.ownerId}, ${input.roomId}, 'GRANT_DENIED', 'SUCCESS', ${nowIso}::timestamptz)`;
      }
      const request = await readGrant(tx, input.grantId);
      if (!request) throw new Error("decided grant row disappeared under its own lock");
      return { request, replayed: false };
    });
  }

  return {
    async requestGrant(input) {
      try {
        return await sql.begin(async (tx) => {
          const [room] = await tx<Array<{ status: RoomStatus }>>`
            SELECT r.status FROM room.rooms r
            JOIN room.members m ON m.room_id = r.id AND m.user_id = ${input.requesterUserId}
            WHERE r.id = ${input.roomId} LIMIT 1`;
          if (!room) return null;
          const refusal = grantRoomStatusRefusal(room.status);
          if (refusal) throw refusal;
          await tx`INSERT INTO room.grant_requests (id, room_id, requester_user_id, note, status, requested_at)
            VALUES (${input.id}, ${input.roomId}, ${input.requesterUserId}, ${input.note}, 'OPEN', ${input.now.toISOString()}::timestamptz)`;
          const request = await readGrant(tx, input.id);
          if (!request) throw new Error("grant request insert did not persist");
          return { request, created: true };
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // The partial unique index is the final arbiter: a concurrent or
        // repeated request converges on the existing OPEN row. Recovery runs
        // OUTSIDE the transaction — a failed statement aborts its transaction
        // (25P02), so the aborted tx cannot serve the read-back.
        const [existing] = await sql<GrantRow[]>`
          SELECT ${GRANT_PROJECTION(sql)} FROM room.grant_requests g
          JOIN identity.users u ON u.id = g.requester_user_id
          WHERE g.room_id = ${input.roomId} AND g.requester_user_id = ${input.requesterUserId} AND g.status = 'OPEN' LIMIT 1`;
        if (!existing) throw error;
        return { request: project(existing), created: false };
      }
    },

    async decideGrant(input) {
      try {
        return await runDecision(input);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Belt over the row lock's braces: if the OWNER_GRANT ledger key ever
        // collides (a decision that raced past the lock), the transaction is
        // aborted and rolled back — recovery reads the stored outcome OUTSIDE
        // it (a failed statement leaves its transaction unusable, 25P02) and
        // converges instead of surfacing a 500.
        const [existing] = await sql<GrantRow[]>`
          SELECT ${GRANT_PROJECTION(sql)} FROM room.grant_requests g
          JOIN identity.users u ON u.id = g.requester_user_id
          WHERE g.id = ${input.grantId} AND g.room_id = ${input.roomId} AND g.status <> 'OPEN' LIMIT 1`;
        if (!existing) throw error;
        return { request: project(existing), replayed: true };
      }
    },

    async listGrants(roomId, viewerUserId) {
      const [membership] = await sql<Array<{ role: "OWNER" | "MEMBER" }>>`
        SELECT m.role FROM room.members m WHERE m.room_id = ${roomId} AND m.user_id = ${viewerUserId} LIMIT 1`;
      if (!membership) return null;
      const isOwner = membership.role === "OWNER";
      // Redaction lives in the WHERE clause: a non-owner's result set simply
      // never contains another member's OPEN or DENIED rows.
      const rows = await sql<GrantRow[]>`
        SELECT ${GRANT_PROJECTION(sql)} FROM room.grant_requests g
        JOIN identity.users u ON u.id = g.requester_user_id
        WHERE g.room_id = ${roomId}
          AND (${isOwner} OR g.status = 'APPROVED' OR g.requester_user_id = ${viewerUserId})
        ORDER BY g.requested_at DESC, g.id LIMIT ${GRANT_LIST_MAX_ROWS}`;
      return { isOwner, requests: rows.map(project) };
    },
  };
}
