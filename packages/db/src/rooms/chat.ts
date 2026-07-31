import { randomUUID } from "node:crypto";

import {
  assertMinimalChatProjection,
  decodeChatCursor,
  encodeChatCursor,
  isDuplicateMessage,
  MESSAGE_PAGE_SIZE,
  MESSAGE_WINDOW_SECONDS,
  MESSAGES_PER_WINDOW,
  muteExpiresAt,
  type ChatMessageProjection,
  type MuteDurationHours,
} from "@pulse/domain";
import type postgres from "postgres";

import { isUniqueViolation } from "../identity/repository.js";
import { OperationError } from "../operations/repository.js";
import { closeExpiredMuteWindows } from "./mutes.js";

/**
 * Room public chat storage (Story 12.3, FR88).
 *
 * Authorization is inlined into SQL, never compared in JS: a non-member's read
 * or write matches zero rows and is answered ROOM_NOT_FOUND — indistinguishable
 * from a room that does not exist (the getRoomForMember shape). Owner-only
 * writes join `role='OWNER'` and answer 404 too: pin/mute entry points must not
 * confirm their own existence to non-owners.
 *
 * The mute gate trusts exactly one predicate: `muted_until > now() AND
 * lifted_at IS NULL` (deferred-work gap ③) — a row that merely has
 * `lifted_at IS NULL` may have expired long ago.
 *
 * No query here joins ledger, prediction or supplier relations (AC4).
 */
export type ChatSql = postgres.Sql;

const OWNER_MUTE_PROJECTION_KEYS = ["muteId", "pulseId", "nickname", "mutedUntil"] as const;

interface MemberContext {
  roomStatus: "ACTIVE" | "RESTRICTED" | "CLOSED";
  role: "OWNER" | "MEMBER";
  pinnedMessageId: string | null;
}

export function createRoomChatRepository(sql: ChatSql, clock: () => Date = () => new Date()) {
  async function memberContext(tx: postgres.ISql, roomId: string, userId: string): Promise<MemberContext> {
    const [row] = await tx<Array<MemberContext>>`
      SELECT r.status AS "roomStatus", m.role, r.pinned_message_id AS "pinnedMessageId"
      FROM room.rooms r JOIN room.members m ON m.room_id = r.id AND m.user_id = ${userId}
      WHERE r.id = ${roomId} LIMIT 1`;
    if (!row) throw new OperationError("ROOM_NOT_FOUND", 404);
    return row;
  }

  async function ownerContext(tx: postgres.ISql, roomId: string, userId: string): Promise<MemberContext> {
    const context = await memberContext(tx, roomId, userId);
    // Same shape as a missing room: a pin/mute surface must not confirm its
    // existence to someone who cannot use it.
    if (context.role !== "OWNER") throw new OperationError("ROOM_NOT_FOUND", 404);
    return context;
  }

  async function activeMuteUntil(tx: postgres.ISql, roomId: string, userId: string, nowIso: string): Promise<string | null> {
    const [row] = await tx<Array<{ mutedUntil: Date | string | null }>>`
      SELECT MAX(muted_until) AS "mutedUntil" FROM room.member_mutes
      WHERE room_id = ${roomId} AND user_id = ${userId} AND lifted_at IS NULL AND muted_until > ${nowIso}`;
    if (!row?.mutedUntil) return null;
    return row.mutedUntil instanceof Date ? row.mutedUntil.toISOString() : new Date(row.mutedUntil).toISOString();
  }

  async function audit(tx: postgres.ISql, input: {
    auditId: string; actorUserId: string; action: string;
    targetType: "ROOM" | "USER"; targetId: string; occurredAt: string; metadata: Record<string, unknown>;
  }): Promise<void> {
    await tx`INSERT INTO ops.audit_events (id,actor_user_id,action,target_type,target_id,result,metadata,occurred_at)
      VALUES (${input.auditId},${input.actorUserId},${input.action},${input.targetType},${input.targetId},'SUCCESS',${JSON.stringify(input.metadata)}::text::jsonb,${input.occurredAt})`;
  }

  const messageSelect = (tx: postgres.ISql, roomId: string) => tx`
    SELECT m.id, u.username_canonical AS "authorPulseId", u.nickname AS "authorNickname",
      m.body, m.created_at AS "createdAt",
      (m.id = r.pinned_message_id) AS "isPinned"
    FROM room.messages m
    JOIN room.rooms r ON r.id = m.room_id
    JOIN identity.users u ON u.id = m.user_id
    WHERE m.room_id = ${roomId}
      AND NOT EXISTS (SELECT 1 FROM room.message_moderation mm
        WHERE mm.message_id = m.id AND mm.state = 'HIDDEN')`;

  return {
    /**
     * A member's chat page: pinned message, newest-first keyset page, the
     * caller's own active mute (telling someone about their own mute is not a
     * disclosure), and — for the owner — the room's live owner mutes.
     */
    async listMessages(roomId: string, userId: string, options: { cursor?: string } = {}) {
      const context = await memberContext(sql, roomId, userId);
      const nowIso = clock().toISOString();

      let cursorPredicate = sql``;
      if (options.cursor) {
        const cursor = decodeChatCursor(options.cursor);
        if (!cursor) throw new OperationError("INVALID_REQUEST", 422);
        cursorPredicate = sql`AND (m.created_at, m.id) < (${cursor.createdAt}, ${cursor.id})`;
      }
      const page = await sql<ChatMessageProjection[]>`
        ${messageSelect(sql, roomId)} ${cursorPredicate}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ${MESSAGE_PAGE_SIZE + 1}`;
      const hasMore = page.length > MESSAGE_PAGE_SIZE;
      const messages = hasMore ? page.slice(0, MESSAGE_PAGE_SIZE) : page;
      const last = messages[messages.length - 1];
      const cursor = hasMore && last
        ? encodeChatCursor({ createdAt: new Date(last.createdAt).toISOString(), id: last.id })
        : null;

      const pinned = context.pinnedMessageId
        ? ((await sql<ChatMessageProjection[]>`
            ${messageSelect(sql, roomId)} AND m.id = ${context.pinnedMessageId} LIMIT 1`)[0] ?? null)
        : null;

      assertMinimalChatProjection(messages);
      assertMinimalChatProjection(pinned);

      let mutes: Array<{ muteId: string; pulseId: string; nickname: string | null; mutedUntil: Date | string }> | undefined;
      if (context.role === "OWNER") {
        mutes = await sql<NonNullable<typeof mutes>>`
          SELECT mu.id AS "muteId", u.username_canonical AS "pulseId", u.nickname, mu.muted_until AS "mutedUntil"
          FROM room.member_mutes mu JOIN identity.users u ON u.id = mu.user_id
          WHERE mu.room_id = ${roomId} AND mu.report_id IS NULL
            AND mu.lifted_at IS NULL AND mu.muted_until > ${nowIso}
          ORDER BY mu.muted_until DESC`;
        assertMinimalChatProjection(mutes, OWNER_MUTE_PROJECTION_KEYS);
      }

      return {
        messages,
        pinned,
        cursor,
        mutedUntil: await activeMuteUntil(sql, roomId, userId, nowIso),
        canPost: context.roomStatus === "ACTIVE",
        isOwner: context.role === "OWNER",
        ...(mutes ? { mutes } : {}),
      };
    },

    /** Sends one plain-text message; every gate lives in this transaction. */
    async sendMessage(roomId: string, userId: string, body: string): Promise<ChatMessageProjection> {
      return await sql.begin(async (tx) => {
        // Serialize sends per (room, user): the rate and duplicate gates below
        // are count-then-insert under READ COMMITTED, so without this lock a
        // parallel burst all counts the same committed state and every request
        // passes. The lock is transaction-scoped — released on commit/abort.
        await tx`SELECT pg_advisory_xact_lock(hashtextextended('room-chat-send:' || ${roomId} || ':' || ${userId}, 0))`;
        const context = await memberContext(tx, roomId, userId);
        // RESTRICTED is readable but not writable — that is what the governance
        // restriction means. CLOSED rooms are read-only history.
        if (context.roomStatus !== "ACTIVE") throw new OperationError("ROOM_NOT_ACTIVE", 409);

        const now = clock();
        const nowIso = now.toISOString();
        // Gap ③: trust only the time window, never `lifted_at IS NULL` alone.
        if (await activeMuteUntil(tx, roomId, userId, nowIso)) throw new OperationError("MUTED", 403);

        const windowStartIso = new Date(now.getTime() - MESSAGE_WINDOW_SECONDS * 1000).toISOString();
        const [window] = await tx<Array<{ recent: string | number }>>`
          SELECT count(*) AS recent FROM room.messages
          WHERE room_id = ${roomId} AND user_id = ${userId} AND created_at >= ${windowStartIso}`;
        if (Number(window?.recent ?? 0) >= MESSAGES_PER_WINDOW) throw new OperationError("RATE_LIMITED", 429);

        const [previous] = await tx<Array<{ body: string }>>`
          SELECT body FROM room.messages WHERE room_id = ${roomId} AND user_id = ${userId}
          ORDER BY created_at DESC, id DESC LIMIT 1`;
        if (isDuplicateMessage(previous?.body ?? null, body)) throw new OperationError("DUPLICATE_MESSAGE", 422);

        const [inserted] = await tx<Array<{ id: string; createdAt: Date | string }>>`
          INSERT INTO room.messages (room_id, user_id, body, created_at)
          VALUES (${roomId}, ${userId}, ${body}, ${nowIso})
          RETURNING id, created_at AS "createdAt"`;
        const [author] = await tx<Array<{ pulseId: string; nickname: string | null }>>`
          SELECT username_canonical AS "pulseId", nickname FROM identity.users WHERE id = ${userId} LIMIT 1`;

        const message: ChatMessageProjection = {
          id: inserted!.id,
          authorPulseId: author!.pulseId,
          authorNickname: author!.nickname,
          body,
          createdAt: inserted!.createdAt instanceof Date ? inserted!.createdAt : new Date(inserted!.createdAt),
          isPinned: false,
        };
        assertMinimalChatProjection(message);
        return message;
      });
    },

    /** Owner pins one visible message; the previous pin is replaced (single slot). */
    async pinMessage(roomId: string, ownerId: string, messageId: string) {
      const auditId = randomUUID();
      return await sql.begin(async (tx) => {
        await ownerContext(tx, roomId, ownerId);
        const nowIso = clock().toISOString();
        const [pinned] = await tx<Array<{ messageId: string }>>`
          UPDATE room.rooms r SET pinned_message_id = m.id, pinned_by = ${ownerId}, pinned_at = ${nowIso}, updated_at = ${nowIso}
          FROM room.messages m
          WHERE r.id = ${roomId} AND m.id = ${messageId} AND m.room_id = r.id
            AND NOT EXISTS (SELECT 1 FROM room.message_moderation mm
              WHERE mm.message_id = m.id AND mm.state = 'HIDDEN')
          RETURNING m.id AS "messageId"`;
        if (!pinned) throw new OperationError("MESSAGE_NOT_FOUND", 404);
        await audit(tx, { auditId, actorUserId: ownerId, action: "MESSAGE_PINNED", targetType: "ROOM", targetId: roomId, occurredAt: nowIso, metadata: { messageId } });
        return { pinned: true as const, messageId, auditId };
      });
    },

    async unpinMessage(roomId: string, ownerId: string) {
      const auditId = randomUUID();
      return await sql.begin(async (tx) => {
        const context = await ownerContext(tx, roomId, ownerId);
        if (!context.pinnedMessageId) throw new OperationError("MESSAGE_NOT_PINNED", 409);
        const nowIso = clock().toISOString();
        await tx`UPDATE room.rooms SET pinned_message_id = NULL, pinned_by = NULL, pinned_at = NULL, updated_at = ${nowIso}
          WHERE id = ${roomId}`;
        await audit(tx, { auditId, actorUserId: ownerId, action: "MESSAGE_UNPINNED", targetType: "ROOM", targetId: roomId, occurredAt: nowIso, metadata: { messageId: context.pinnedMessageId } });
        return { pinned: false as const, auditId };
      });
    },

    /**
     * Owner mutes a member of their own room: reason required, duration from
     * the closed list, expired windows settled first so the partial unique
     * index cannot refuse a legitimate mute months later. `report_id IS NULL`
     * marks the owner path — the governance inbox path always carries one.
     */
    async muteMember(roomId: string, ownerId: string, input: { memberUserId: string; muteHours: MuteDurationHours; reason: string }) {
      const auditId = randomUUID();
      const muteId = randomUUID();
      return await sql.begin(async (tx) => {
        await ownerContext(tx, roomId, ownerId);
        if (input.memberUserId === ownerId) throw new OperationError("SELF_MUTE_FORBIDDEN", 422);
        const [member] = await tx<Array<{ userId: string }>>`
          SELECT user_id AS "userId" FROM room.members
          WHERE room_id = ${roomId} AND user_id = ${input.memberUserId} LIMIT 1`;
        if (!member) throw new OperationError("MEMBER_NOT_FOUND", 404);

        const now = clock();
        const nowIso = now.toISOString();
        await closeExpiredMuteWindows(tx, roomId, input.memberUserId, nowIso);
        const mutedUntil = muteExpiresAt(now, input.muteHours).toISOString();
        try {
          await tx`INSERT INTO room.member_mutes (id,room_id,user_id,report_id,reason,muted_by,muted_at,muted_until)
            VALUES (${muteId},${roomId},${input.memberUserId},${null},${input.reason},${ownerId},${nowIso},${mutedUntil})`;
        } catch (error) {
          if (isUniqueViolation(error)) throw new OperationError("MUTE_ALREADY_ACTIVE", 409);
          throw error;
        }
        // FR90 + deferred-work gap ②: the sanction is findable by the person it
        // landed on (target USER), and it counts as the high-risk action it is.
        await audit(tx, {
          auditId, actorUserId: ownerId, action: "MEMBER_MUTED", targetType: "USER", targetId: input.memberUserId,
          occurredAt: nowIso, metadata: { roomId, muteId, reason: input.reason, mutedUntil, mutedBy: "ROOM_OWNER" },
        });
        return { muteId, mutedUntil, auditId };
      });
    },

    /** Owner lifts an owner mute (`report_id IS NULL`); inbox mutes stay with the inbox. */
    async unmuteMember(roomId: string, ownerId: string, muteId: string, reason: string) {
      const auditId = randomUUID();
      return await sql.begin(async (tx) => {
        await ownerContext(tx, roomId, ownerId);
        const nowIso = clock().toISOString();
        const [lifted] = await tx<Array<{ userId: string }>>`
          UPDATE room.member_mutes SET lifted_by = ${ownerId}, lifted_at = ${nowIso}
          WHERE id = ${muteId} AND room_id = ${roomId} AND report_id IS NULL
            AND lifted_at IS NULL AND muted_until > ${nowIso}
          RETURNING user_id AS "userId"`;
        if (!lifted) throw new OperationError("MUTE_NOT_ACTIVE", 409);
        await audit(tx, {
          auditId, actorUserId: ownerId, action: "MEMBER_UNMUTED", targetType: "USER", targetId: lifted.userId,
          occurredAt: nowIso, metadata: { roomId, muteId, reason, mutedBy: "ROOM_OWNER" },
        });
        return { lifted: true as const, auditId };
      });
    },
  };
}

export type RoomChatRepository = ReturnType<typeof createRoomChatRepository>;
