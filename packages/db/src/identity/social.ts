import {
  assertMinimalFriendProjection,
  BLOCK_PROJECTION_KEYS,
  BLOCKS_PER_DAY,
  BLOCKS_PER_HOUR,
  canonicalPair,
  canRespondToRequest,
  decideFriendRequest,
  FRIEND_LIST_PROJECTION_KEYS,
  FRIEND_REQUEST_PROJECTION_KEYS,
  FRIEND_REQUESTS_PER_DAY,
  FRIEND_REQUESTS_PER_HOUR,
  PRESENCE_PREFERENCES_PROJECTION_KEYS,
  PRESENCE_TTL_MS,
  type FriendshipStatus,
  type PresencePreferences,
  type RespondAction,
  type SocialWriteKind,
} from "@pulse/domain";
import type postgres from "postgres";

import { avatarColumns, avatarJoin, withAvatar, withoutAvatar } from "./avatar-projection.js";
import { isUniqueViolation } from "./repository.js";
import { OperationError } from "../operations/repository.js";

/**
 * Friends, blocks, privacy toggles and presence heartbeats (Story 12.1).
 *
 * Everything here reads and writes the identity schema only — no join, FK or
 * write path reaches rooms, predictions, balances or settlement (FR59/NFR19),
 * and every outgoing projection passes the minimal-disclosure guard.
 *
 * Anti-enumeration stance (AC2): a blocked requester gets the exact same
 * response — and the exact same persisted state — as a successful one. The
 * request row IS written under a block; only the blocker's own views filter it
 * (viewer-directional) and the respond path refuses it. Writing nothing was the
 * original design and it leaked: the requester's own outbox and the pair-DELETE
 * result both betrayed the missing row. Rate-limit events are recorded before
 * the PULSE ID even resolves, so probing (hits, misses, blocked targets alike)
 * costs exactly one quota unit per attempt on both the request and block paths.
 */
export type SocialSql = postgres.Sql;

export interface FriendEntry {
  userId: string;
  pulseId: string;
  nickname: string | null;
  online: boolean;
  /** Same-origin media path, or null when the account has no avatar (Story 12.6). */
  avatarUrl: string | null;
  avatarVersion: number | null;
}

export interface FriendRequestEntry {
  requestId: string;
  direction: "INCOMING" | "OUTGOING";
  /** The counterpart's id — what the requester-side withdrawal (DELETE /friends/{userId}) needs. */
  userId: string;
  pulseId: string;
  nickname: string | null;
  createdAt: Date;
  avatarUrl: string | null;
  avatarVersion: number | null;
}

export interface BlockEntry {
  userId: string;
  pulseId: string;
  nickname: string | null;
  createdAt: Date;
  /** Always null: a blocker stops receiving the blocked account's photo (Story 12.6). */
  avatarUrl: null;
  avatarVersion: null;
}

export function createSocialRepository(sql: SocialSql, clock: () => Date = () => new Date()) {
  async function resolveActiveUserByPulseId(tx: postgres.ISql, pulseId: string): Promise<string> {
    const [target] = await tx<Array<{ id: string }>>`
      SELECT id FROM identity.users
      WHERE username_canonical = ${pulseId} AND status = 'ACTIVE' LIMIT 1`;
    if (!target) throw new OperationError("USER_NOT_FOUND", 404);
    return target.id;
  }

  async function pairIsBlocked(tx: postgres.ISql, a: string, b: string): Promise<boolean> {
    const rows = await tx<Array<{ present: number }>>`
      SELECT 1 AS present FROM identity.user_blocks
      WHERE (blocker_user_id = ${a} AND blocked_user_id = ${b})
         OR (blocker_user_id = ${b} AND blocked_user_id = ${a})
      LIMIT 1`;
    return rows.length > 0;
  }

  /**
   * Consumes one unit of the social-write quota BEFORE anything about the
   * target is resolved: attempts are what get counted (hits, unknown PULSE IDs
   * and blocked targets all cost the same unit), so neither endpoint is a free
   * existence oracle. The per-requester advisory lock makes the
   * count-then-insert atomic against parallel attempts from the same account.
   *
   * Must run in its OWN committed transaction, never inside the write it
   * prices: a refused write (USER_NOT_FOUND, SELF_*) aborts its transaction,
   * and an event row that rolls back with it would make exactly the failed
   * probes free — the opposite of attempt pricing.
   */
  async function consumeSocialWriteQuota(
    tx: postgres.ISql,
    userId: string,
    kind: SocialWriteKind,
    perHour: number,
    perDay: number,
  ): Promise<void> {
    const now = clock();
    const nowIso = now.toISOString();
    const hourAgoIso = new Date(now.getTime() - 3_600_000).toISOString();
    const dayAgoIso = new Date(now.getTime() - 86_400_000).toISOString();
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('social-write:' || ${userId}, 0))`;
    const [window] = await tx<Array<{ hourCount: string | number; dayCount: string | number }>>`
      SELECT count(*) FILTER (WHERE occurred_at >= ${hourAgoIso}) AS "hourCount", count(*) AS "dayCount"
      FROM identity.friend_request_events
      WHERE requester_user_id = ${userId} AND kind = ${kind} AND occurred_at >= ${dayAgoIso}`;
    if (Number(window?.hourCount ?? 0) >= perHour || Number(window?.dayCount ?? 0) >= perDay) {
      throw new OperationError("RATE_LIMITED", 429);
    }
    await tx`INSERT INTO identity.friend_request_events (requester_user_id, kind, occurred_at)
      VALUES (${userId}, ${kind}, ${nowIso})`;
  }

  async function requestFriendOnce(requesterId: string, pulseId: string): Promise<{ status: FriendshipStatus }> {
    return await sql.begin(async (tx) => {
      const targetId = await resolveActiveUserByPulseId(tx, pulseId);
      if (targetId === requesterId) throw new OperationError("SELF_FRIEND_FORBIDDEN", 422);

      const nowIso = clock().toISOString();
      const blocked = await pairIsBlocked(tx, requesterId, targetId);
      const pair = canonicalPair(requesterId, targetId);
      // The existing row is read (and locked) on the blocked path too: the
      // request must land or replay exactly as on the normal path, so the
      // requester's own outbox never betrays the block (AC2).
      const existing =
        (await tx<Array<{ status: FriendshipStatus; requestedBy: string }>>`
          SELECT status, requested_by AS "requestedBy" FROM identity.friendships
          WHERE user_lo_id = ${pair.loUserId} AND user_hi_id = ${pair.hiUserId}
          FOR UPDATE`)[0] ?? null;

      const decision = decideFriendRequest({ requesterId, targetId, existing, blocked });
      switch (decision.kind) {
        case "CREATE":
          await tx`INSERT INTO identity.friendships (user_lo_id, user_hi_id, status, requested_by, created_at)
            VALUES (${pair.loUserId}, ${pair.hiUserId}, 'PENDING', ${requesterId}, ${nowIso})`;
          return { status: "PENDING" as const };
        case "ACCEPT":
          await tx`UPDATE identity.friendships SET status = 'ACCEPTED', responded_at = ${nowIso}
            WHERE user_lo_id = ${pair.loUserId} AND user_hi_id = ${pair.hiUserId} AND status = 'PENDING'`;
          return { status: "ACCEPTED" as const };
        case "NOOP":
          return { status: decision.status };
      }
    });
  }

  return {
    /**
     * Creates/replays a friend request addressed by PULSE ID. Retried once as a
     * whole transaction on a pair-unique violation: 23505 inside a transaction
     * aborts it, so the losing side of a concurrent mutual request must re-run
     * from the top, where it now sees the winner's row and ACCEPTs or NOOPs.
     */
    async requestFriend(requesterId: string, pulseId: string): Promise<{ status: FriendshipStatus }> {
      // Quota commits on its own, before (and outside) the retried write: the
      // attempt is priced even when the write itself is refused, and the
      // unique-race retry does not charge a second unit.
      await sql.begin(async (tx) => {
        await consumeSocialWriteQuota(tx, requesterId, "FRIEND_REQUEST", FRIEND_REQUESTS_PER_HOUR, FRIEND_REQUESTS_PER_DAY);
      });
      try {
        return await requestFriendOnce(requesterId, pulseId);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return await requestFriendOnce(requesterId, pulseId);
      }
    },

    async respondToFriendRequest(
      responderId: string,
      requestId: string,
      action: RespondAction,
    ): Promise<{ status: "ACCEPTED" | "DECLINED" }> {
      return await sql.begin(async (tx) => {
        const [row] = await tx<
          Array<{ id: string; userLoId: string; userHiId: string; status: FriendshipStatus; requestedBy: string }>
        >`
          SELECT id, user_lo_id AS "userLoId", user_hi_id AS "userHiId", status, requested_by AS "requestedBy"
          FROM identity.friendships
          WHERE id = ${requestId} AND (user_lo_id = ${responderId} OR user_hi_id = ${responderId})
          FOR UPDATE`;
        if (!row || !canRespondToRequest({ responderId, requestedBy: row.requestedBy, status: row.status })) {
          throw new OperationError("REQUEST_NOT_FOUND", 404);
        }
        const otherId = row.userLoId === responderId ? row.userHiId : row.userLoId;
        if (await pairIsBlocked(tx, responderId, otherId)) {
          throw new OperationError("REQUEST_NOT_FOUND", 404);
        }
        if (action === "accept") {
          await tx`UPDATE identity.friendships SET status = 'ACCEPTED', responded_at = ${clock().toISOString()}
            WHERE id = ${row.id}`;
          return { status: "ACCEPTED" as const };
        }
        await tx`DELETE FROM identity.friendships WHERE id = ${row.id}`;
        return { status: "DECLINED" as const };
      });
    },

    /** Removes a friendship (or cancels an own pending request) for the pair. */
    async removeFriend(userId: string, friendUserId: string): Promise<{ removed: boolean }> {
      if (userId === friendUserId) return { removed: false };
      const pair = canonicalPair(userId, friendUserId);
      const rows = await sql<Array<{ id: string }>>`
        DELETE FROM identity.friendships
        WHERE user_lo_id = ${pair.loUserId} AND user_hi_id = ${pair.hiUserId}
        RETURNING id`;
      return { removed: rows.length > 0 };
    },

    async listFriends(userId: string): Promise<FriendEntry[]> {
      const ttlCutoffIso = new Date(clock().getTime() - PRESENCE_TTL_MS).toISOString();
      const joined = await sql<Array<Omit<FriendEntry, "avatarUrl" | "avatarVersion"> & { avatarPublicId: string | null; avatarVersion: number | null }>>`
        SELECT u.id AS "userId", u.username_canonical AS "pulseId", u.nickname,
          COALESCE(u.show_online_to_friends AND p.online_beat_at > ${ttlCutoffIso}, false) AS online,
          ${avatarColumns(sql)}
        FROM identity.friendships f
        JOIN identity.users u
          ON u.id = CASE WHEN f.user_lo_id = ${userId} THEN f.user_hi_id ELSE f.user_lo_id END
        LEFT JOIN identity.presence_signals p ON p.user_id = u.id
        ${avatarJoin(sql)}
        WHERE (f.user_lo_id = ${userId} OR f.user_hi_id = ${userId})
          AND f.status = 'ACCEPTED' AND u.status = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1 FROM identity.user_blocks b
            WHERE (b.blocker_user_id = ${userId} AND b.blocked_user_id = u.id)
               OR (b.blocker_user_id = u.id AND b.blocked_user_id = ${userId}))
        ORDER BY u.username_canonical`;
      // The join column is mapped to the public pair before the guard runs, so a
      // forgotten mapping fails loudly instead of shipping the storage handle.
      const rows = joined.map(withAvatar) as FriendEntry[];
      assertMinimalFriendProjection(rows, FRIEND_LIST_PROJECTION_KEYS);
      return rows;
    },

    async listFriendRequests(userId: string): Promise<FriendRequestEntry[]> {
      // Viewer-directional block filter, deliberately NOT bidirectional: the
      // viewer's own blocks hide the counterpart, but a block AGAINST the
      // viewer must not make their outgoing request vanish from their own
      // outbox — that disappearance is exactly the "you are blocked" signal
      // AC2 forbids. The counterpart still never sees it: their view is
      // filtered by THEIR block, and the respond path re-checks the pair.
      //
      // The avatar rides the plain join here, with no extra block condition. The
      // row filter above already removes everyone the viewer blocked, and the
      // remaining block case — the counterpart blocked the viewer — must look
      // exactly like no block at all: an avatar that vanished from the viewer's
      // own outbox would be the disclosure AC2 exists to prevent.
      const joined = await sql<Array<Omit<FriendRequestEntry, "avatarUrl" | "avatarVersion"> & { avatarPublicId: string | null; avatarVersion: number | null }>>`
        SELECT f.id AS "requestId",
          CASE WHEN f.requested_by = ${userId} THEN 'OUTGOING' ELSE 'INCOMING' END AS direction,
          u.id AS "userId", u.username_canonical AS "pulseId", u.nickname, f.created_at AS "createdAt",
          ${avatarColumns(sql)}
        FROM identity.friendships f
        JOIN identity.users u
          ON u.id = CASE WHEN f.user_lo_id = ${userId} THEN f.user_hi_id ELSE f.user_lo_id END
        ${avatarJoin(sql)}
        WHERE (f.user_lo_id = ${userId} OR f.user_hi_id = ${userId})
          AND f.status = 'PENDING' AND u.status = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1 FROM identity.user_blocks b
            WHERE b.blocker_user_id = ${userId} AND b.blocked_user_id = u.id)
        ORDER BY f.created_at DESC`;
      const rows = joined.map(withAvatar) as FriendRequestEntry[];
      assertMinimalFriendProjection(rows, FRIEND_REQUEST_PROJECTION_KEYS);
      return rows;
    },

    /**
     * Blocking also severs any existing friendship/request in the same
     * transaction. Deleting a PENDING row here is indistinguishable from a
     * decline on the requester's side (both make the entry disappear
     * silently), so it carries no block signal. Quota is consumed before the
     * PULSE ID resolves — this endpoint resolves handles too, and unthrottled
     * it would be a free existence oracle around the friend-request limit.
     */
    async blockUser(blockerId: string, pulseId: string): Promise<{ blocked: true }> {
      // Same shape as requestFriend: the attempt is priced in its own
      // committed transaction so a refused block still costs a unit.
      await sql.begin(async (tx) => {
        await consumeSocialWriteQuota(tx, blockerId, "BLOCK", BLOCKS_PER_HOUR, BLOCKS_PER_DAY);
      });
      return await sql.begin(async (tx) => {
        const targetId = await resolveActiveUserByPulseId(tx, pulseId);
        if (targetId === blockerId) throw new OperationError("SELF_BLOCK_FORBIDDEN", 422);
        await tx`INSERT INTO identity.user_blocks (blocker_user_id, blocked_user_id, created_at)
          VALUES (${blockerId}, ${targetId}, ${clock().toISOString()})
          ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING`;
        const pair = canonicalPair(blockerId, targetId);
        await tx`DELETE FROM identity.friendships
          WHERE user_lo_id = ${pair.loUserId} AND user_hi_id = ${pair.hiUserId}`;
        return { blocked: true as const };
      });
    },

    async unblockUser(blockerId: string, blockedUserId: string): Promise<{ unblocked: boolean }> {
      const rows = await sql<Array<{ blockedUserId: string }>>`
        DELETE FROM identity.user_blocks
        WHERE blocker_user_id = ${blockerId} AND blocked_user_id = ${blockedUserId}
        RETURNING blocked_user_id AS "blockedUserId"`;
      return { unblocked: rows.length > 0 };
    },

    /**
     * The blocker's own list. It deliberately carries no avatar: a block stops
     * the pair from being shown each other's photo, and this is the one surface
     * where a blocked account is still listed. The nickname and PULSE ID are
     * enough to recognise an entry and unblock it, and the UI renders its
     * low-emphasis initials fallback in the avatar slot.
     */
    async listBlocks(blockerId: string): Promise<BlockEntry[]> {
      const joined = await sql<Array<Omit<BlockEntry, "avatarUrl" | "avatarVersion">>>`
        SELECT u.id AS "userId", u.username_canonical AS "pulseId", u.nickname, b.created_at AS "createdAt"
        FROM identity.user_blocks b
        JOIN identity.users u ON u.id = b.blocked_user_id
        WHERE b.blocker_user_id = ${blockerId}
        ORDER BY b.created_at DESC`;
      const rows = joined.map(withoutAvatar) as BlockEntry[];
      assertMinimalFriendProjection(rows, BLOCK_PROJECTION_KEYS);
      return rows;
    },

    async getPrivacyPreferences(userId: string): Promise<PresencePreferences> {
      const [row] = await sql<PresencePreferences[]>`
        SELECT show_online_to_friends AS "showOnlineToFriends", show_lobby_to_friends AS "showLobbyToFriends",
          show_in_lobby_directory AS "showInLobbyDirectory"
        FROM identity.users WHERE id = ${userId} LIMIT 1`;
      if (!row) throw new OperationError("USER_NOT_FOUND", 404);
      assertMinimalFriendProjection(row, PRESENCE_PREFERENCES_PROJECTION_KEYS);
      return row;
    },

    async updatePrivacyPreferences(
      userId: string,
      patch: Partial<PresencePreferences>,
    ): Promise<PresencePreferences> {
      const [row] = await sql<PresencePreferences[]>`
        UPDATE identity.users SET
          show_online_to_friends = COALESCE(${patch.showOnlineToFriends ?? null}, show_online_to_friends),
          show_lobby_to_friends = COALESCE(${patch.showLobbyToFriends ?? null}, show_lobby_to_friends),
          show_in_lobby_directory = COALESCE(${patch.showInLobbyDirectory ?? null}, show_in_lobby_directory),
          updated_at = ${clock().toISOString()}
        WHERE id = ${userId}
        RETURNING show_online_to_friends AS "showOnlineToFriends", show_lobby_to_friends AS "showLobbyToFriends",
          show_in_lobby_directory AS "showInLobbyDirectory"`;
      if (!row) throw new OperationError("USER_NOT_FOUND", 404);
      assertMinimalFriendProjection(row, PRESENCE_PREFERENCES_PROJECTION_KEYS);
      return row;
    },

    /**
     * Records a heartbeat, gated in SQL on account status and consent: with
     * every toggle off, no row is ever written no matter what the client sends
     * — the server, not the UI, enforces the opt-in (FR85).
     *
     * Story 12.4: a `lobby` surface additionally stamps `lobby_beat_at`, under
     * its own consent (either friend-facing lobby toggle or the directory
     * toggle). Each column only ever carries a beat its OWN toggle allows —
     * `online_beat_at` is written under `show_online_to_friends` alone, never
     * under a sibling toggle's consent — and COALESCE in the upsert keeps the
     * other column's last value intact.
     */
    async recordHeartbeat(userId: string, surface?: "lobby"): Promise<{ recorded: boolean }> {
      const nowIso = clock().toISOString();
      const lobby = surface === "lobby";
      const rows = await sql<Array<{ userId: string }>>`
        INSERT INTO identity.presence_signals (user_id, online_beat_at, lobby_beat_at, updated_at)
        SELECT u.id,
          CASE WHEN u.show_online_to_friends THEN ${nowIso}::timestamptz END,
          CASE WHEN ${lobby} AND (u.show_lobby_to_friends OR u.show_in_lobby_directory) THEN ${nowIso}::timestamptz END,
          ${nowIso}
        FROM identity.users u
        WHERE u.id = ${userId} AND u.status = 'ACTIVE'
          AND (u.show_online_to_friends
            OR (${lobby} AND (u.show_lobby_to_friends OR u.show_in_lobby_directory)))
        ON CONFLICT (user_id) DO UPDATE SET
          online_beat_at = COALESCE(EXCLUDED.online_beat_at, identity.presence_signals.online_beat_at),
          lobby_beat_at = COALESCE(EXCLUDED.lobby_beat_at, identity.presence_signals.lobby_beat_at),
          updated_at = EXCLUDED.updated_at
        RETURNING user_id AS "userId"`;
      return { recorded: rows.length > 0 };
    },
  };
}

export type SocialRepository = ReturnType<typeof createSocialRepository>;
