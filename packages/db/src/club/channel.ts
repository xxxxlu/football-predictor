import {
  assertMinimalLobbyProjection,
  CHANNEL_MESSAGE_PROJECTION_KEYS,
  CHANNEL_MESSAGES_PER_WINDOW,
  CHANNEL_PAGE_SIZE,
  CHANNEL_READ_WINDOW_MESSAGES,
  CHANNEL_WINDOW_SECONDS,
  CHANNEL_WRITE_REFUSALS,
  COMMUNITY_RULES_VERSION,
  decodeChatCursor,
  encodeChatCursor,
  FRIEND_ACTIVITY_PROJECTION_KEYS,
  isDuplicateMessage,
  LOBBY_DIRECTORY_PROJECTION_KEYS,
  PRESENCE_TTL_MS,
  type ChannelMessageProjection,
} from "@pulse/domain";
import type postgres from "postgres";

import { avatarColumns, avatarJoin, withAuthorAvatar, withAvatar } from "../identity/avatar-projection.js";
import { OperationError } from "../operations/repository.js";

/**
 * PULSE CLUB channel and lobby storage (Story 12.4, FR89).
 *
 * Everything here reads identity.* and club.* only — no query joins room,
 * prediction, ledger or supplier relations (AC1), and every outgoing shape
 * passes the lobby projection guard.
 *
 * The write gates all live in one transaction and all belong to the server:
 * rules confirmation (identity.rule_acceptances, community namespace), the
 * community mute (`muted_until > now()` — never `lifted_at` alone, the 12.3
 * red line), the per-user rate window and the consecutive-duplicate guard.
 *
 * Blocks apply in *both* directions to everything the lobby shows: the
 * channel and the directory are open spaces, unlike a member-run room (the
 * 12.3 decision that room chat ignores blocks deliberately does not carry
 * over here).
 */
export type ClubChannelSql = postgres.Sql;

/** A message row as it comes back from the avatar join, before the pair is derived. */
type AuthorAvatarRow = Omit<ChannelMessageProjection, "authorAvatarUrl" | "authorAvatarVersion"> & {
  avatarPublicId: string | null;
  avatarVersion: number | null;
};

/**
 * Settles community mute windows that have already run out, so the "one live
 * mute per user" partial unique index cannot refuse a legitimate mute months
 * later. Same contract as closeExpiredMuteWindows for rooms (12.3): read paths
 * must still gate on `muted_until > now()` themselves.
 */
export async function closeExpiredChannelMuteWindows(tx: postgres.ISql, userId: string, nowIso: string): Promise<void> {
  await tx`UPDATE club.channel_mutes SET lifted_at = muted_until
    WHERE user_id = ${userId} AND lifted_at IS NULL AND muted_until <= ${nowIso}`;
}

const blockedPairPredicate = (tx: postgres.ISql, viewerId: string) => tx`
  NOT EXISTS (SELECT 1 FROM identity.user_blocks b
    WHERE (b.blocker_user_id = ${viewerId} AND b.blocked_user_id = u.id)
       OR (b.blocker_user_id = u.id AND b.blocked_user_id = ${viewerId}))`;

export function createClubChannelRepository(sql: ClubChannelSql, clock: () => Date = () => new Date()) {
  async function hasConfirmedRules(tx: postgres.ISql, userId: string): Promise<boolean> {
    const rows = await tx<Array<{ present: number }>>`
      SELECT 1 AS present FROM identity.rule_acceptances
      WHERE user_id = ${userId} AND rules_version = ${COMMUNITY_RULES_VERSION} LIMIT 1`;
    return rows.length > 0;
  }

  async function activeMuteUntil(tx: postgres.ISql, userId: string, nowIso: string): Promise<string | null> {
    const [row] = await tx<Array<{ mutedUntil: Date | string | null }>>`
      SELECT MAX(muted_until) AS "mutedUntil" FROM club.channel_mutes
      WHERE user_id = ${userId} AND lifted_at IS NULL AND muted_until > ${nowIso}`;
    if (!row?.mutedUntil) return null;
    return row.mutedUntil instanceof Date ? row.mutedUntil.toISOString() : new Date(row.mutedUntil).toISOString();
  }

  return {
    /** The caller's own confirmation state for the current community rules. */
    async getCommunityRulesStatus(userId: string) {
      return { version: COMMUNITY_RULES_VERSION, confirmed: await hasConfirmedRules(sql, userId) };
    },

    /**
     * Confirms the current community rules. Idempotent by the
     * (user_id, rules_version) primary key; `is_adult_confirmed` carries the
     * account's existing confirmation forward — this path never introduces a
     * second adulthood semantics (12.4 dev note). Registration always writes an
     * acceptance row, so the COALESCE fallback is for rows created outside that
     * flow — and it must default to false: absence of a confirmation is never a
     * confirmation.
     */
    async acceptCommunityRules(userId: string) {
      const nowIso = clock().toISOString();
      await sql`
        INSERT INTO identity.rule_acceptances (user_id, rules_version, is_adult_confirmed, accepted_at)
        SELECT u.id, ${COMMUNITY_RULES_VERSION},
          COALESCE((SELECT bool_or(ra.is_adult_confirmed) FROM identity.rule_acceptances ra WHERE ra.user_id = u.id), false),
          ${nowIso}
        FROM identity.users u WHERE u.id = ${userId} AND u.status = 'ACTIVE'
        ON CONFLICT (user_id, rules_version) DO NOTHING`;
      const confirmed = await hasConfirmedRules(sql, userId);
      if (!confirmed) throw new OperationError("USER_NOT_FOUND", 404);
      return { version: COMMUNITY_RULES_VERSION, confirmed: true as const };
    },

    /**
     * The channel page a viewer may read: newest-first keyset page excluding
     * HIDDEN messages and messages from authors the viewer has a block with in
     * either direction, plus the viewer's own write-gate state (their own mute
     * and rules confirmation are not disclosures). The read window bounds how
     * far back any viewer can paginate: only the newest
     * CHANNEL_READ_WINDOW_MESSAGES stored messages are reachable (the 12.4
     * product default) — older history stays stored but is not served.
     */
    async listMessages(viewerId: string, options: { cursor?: string } = {}) {
      const nowIso = clock().toISOString();

      let cursorPredicate = sql``;
      if (options.cursor) {
        const cursor = decodeChatCursor(options.cursor);
        if (!cursor) throw new OperationError("INVALID_REQUEST", 422);
        cursorPredicate = sql`AND (m.created_at, m.id) < (${cursor.createdAt}, ${cursor.id})`;
      }
      // The channel already drops both directions of a block, so the avatar can
      // ride the plain join: an author a viewer has any block with produces no
      // row at all.
      const page = await sql<Array<AuthorAvatarRow>>`
        SELECT m.id, u.username_canonical AS "authorPulseId", u.nickname AS "authorNickname",
          m.body, m.created_at AS "createdAt", ${avatarColumns(sql)}
        FROM club.channel_messages m
        JOIN identity.users u ON u.id = m.user_id
        ${avatarJoin(sql)}
        WHERE NOT EXISTS (SELECT 1 FROM club.channel_message_moderation mm
            WHERE mm.message_id = m.id AND mm.state = 'HIDDEN')
          AND ${blockedPairPredicate(sql, viewerId)}
          AND NOT EXISTS (
            SELECT 1 FROM (
              SELECT created_at, id FROM club.channel_messages
              ORDER BY created_at DESC, id DESC
              OFFSET ${CHANNEL_READ_WINDOW_MESSAGES - 1} LIMIT 1) edge
            WHERE (m.created_at, m.id) < (edge.created_at, edge.id))
          ${cursorPredicate}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ${CHANNEL_PAGE_SIZE + 1}`;
      const hasMore = page.length > CHANNEL_PAGE_SIZE;
      const messages = (hasMore ? page.slice(0, CHANNEL_PAGE_SIZE) : page).map(withAuthorAvatar) as ChannelMessageProjection[];
      const last = messages[messages.length - 1];
      const cursor = hasMore && last
        ? encodeChatCursor({ createdAt: new Date(last.createdAt).toISOString(), id: last.id })
        : null;
      assertMinimalLobbyProjection(messages, CHANNEL_MESSAGE_PROJECTION_KEYS);

      return {
        messages,
        cursor,
        mutedUntil: await activeMuteUntil(sql, viewerId, nowIso),
        rulesConfirmed: await hasConfirmedRules(sql, viewerId),
      };
    },

    /**
     * Sends one plain-text message. Gate order mirrors the recovery paths of
     * AC2: confirm the rules first, then the mute window, then the rate and
     * duplicate guards — each refusal names exactly one thing to fix.
     */
    async sendMessage(userId: string, body: string): Promise<ChannelMessageProjection> {
      return await sql.begin(async (tx) => {
        // Serialize sends per user: rate and duplicate gates are
        // count-then-insert under READ COMMITTED and need an arbiter against
        // parallel bursts. Transaction-scoped, released on commit/abort.
        await tx`SELECT pg_advisory_xact_lock(hashtextextended('channel-send:' || ${userId}, 0))`;
        const [account] = await tx<Array<{ pulseId: string; nickname: string | null; avatarPublicId: string | null; avatarVersion: number | null }>>`
          SELECT u.username_canonical AS "pulseId", u.nickname, ${avatarColumns(tx)}
          FROM identity.users u ${avatarJoin(tx)}
          WHERE u.id = ${userId} AND u.status = 'ACTIVE' LIMIT 1`;
        if (!account) throw new OperationError("USER_NOT_FOUND", 404);
        const authorAvatar = withAuthorAvatar(account);

        // Statuses come from the domain refusal table so the two cannot drift.
        if (!(await hasConfirmedRules(tx, userId))) {
          throw new OperationError("RULES_CONFIRMATION_REQUIRED", CHANNEL_WRITE_REFUSALS.RULES_CONFIRMATION_REQUIRED);
        }

        const now = clock();
        const nowIso = now.toISOString();
        if (await activeMuteUntil(tx, userId, nowIso)) {
          throw new OperationError("COMMUNITY_MUTED", CHANNEL_WRITE_REFUSALS.COMMUNITY_MUTED);
        }

        const windowStartIso = new Date(now.getTime() - CHANNEL_WINDOW_SECONDS * 1000).toISOString();
        const [window] = await tx<Array<{ recent: string | number }>>`
          SELECT count(*) AS recent FROM club.channel_messages
          WHERE user_id = ${userId} AND created_at >= ${windowStartIso}`;
        if (Number(window?.recent ?? 0) >= CHANNEL_MESSAGES_PER_WINDOW) {
          throw new OperationError("RATE_LIMITED", CHANNEL_WRITE_REFUSALS.RATE_LIMITED);
        }

        const [previous] = await tx<Array<{ body: string }>>`
          SELECT body FROM club.channel_messages WHERE user_id = ${userId}
          ORDER BY created_at DESC, id DESC LIMIT 1`;
        if (isDuplicateMessage(previous?.body ?? null, body)) {
          throw new OperationError("DUPLICATE_MESSAGE", CHANNEL_WRITE_REFUSALS.DUPLICATE_MESSAGE);
        }

        const [inserted] = await tx<Array<{ id: string; createdAt: Date | string }>>`
          INSERT INTO club.channel_messages (user_id, body, created_at)
          VALUES (${userId}, ${body}, ${nowIso})
          RETURNING id, created_at AS "createdAt"`;

        const message: ChannelMessageProjection = {
          id: inserted!.id,
          authorPulseId: account.pulseId,
          authorNickname: account.nickname,
          authorAvatarUrl: authorAvatar.authorAvatarUrl,
          authorAvatarVersion: authorAvatar.authorAvatarVersion,
          body,
          createdAt: inserted!.createdAt instanceof Date ? inserted!.createdAt : new Date(inserted!.createdAt),
        };
        assertMinimalLobbyProjection(message, CHANNEL_MESSAGE_PROJECTION_KEYS);
        return message;
      });
    },

    /**
     * The lobby directory: members who opted in (their own toggle, not either
     * friend-facing one), whose lobby beat is inside the TTL, minus anyone the
     * viewer has a block with in either direction. Public pair only.
     */
    async lobbyDirectory(viewerId: string) {
      const ttlCutoffIso = new Date(clock().getTime() - PRESENCE_TTL_MS).toISOString();
      const joined = await sql<Array<{ pulseId: string; nickname: string | null; avatarPublicId: string | null; avatarVersion: number | null }>>`
        SELECT u.username_canonical AS "pulseId", u.nickname, ${avatarColumns(sql)}
        FROM identity.users u
        JOIN identity.presence_signals p ON p.user_id = u.id
        ${avatarJoin(sql)}
        WHERE u.status = 'ACTIVE' AND u.show_in_lobby_directory
          AND p.lobby_beat_at > ${ttlCutoffIso}
          AND ${blockedPairPredicate(sql, viewerId)}
        ORDER BY u.username_canonical
        LIMIT 100`;
      const rows = joined.map(withAvatar);
      assertMinimalLobbyProjection(rows, LOBBY_DIRECTORY_PROJECTION_KEYS);
      return rows;
    },

    /**
     * Friend activity: presence (12.1 consent semantics) × today's challenge
     * completion (12.2). `answeredToday` is null across the board until the
     * viewer has answered today's challenge themselves — the mutual-submission
     * gate, so the lobby cannot become a side channel around 12.2.
     */
    async friendActivity(viewerId: string, productDay: string) {
      const ttlCutoffIso = new Date(clock().getTime() - PRESENCE_TTL_MS).toISOString();
      const [viewer] = await sql<Array<{ answered: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM club.daily_challenge_attempts a
          WHERE a.user_id = ${viewerId} AND a.product_day = ${productDay}) AS answered`;
      const viewerAnswered = viewer?.answered ?? false;
      const joined = await sql<
        Array<{
          pulseId: string; nickname: string | null; online: boolean; inLobby: boolean; answeredToday: boolean | null;
          avatarPublicId: string | null; avatarVersion: number | null;
        }>
      >`
        SELECT u.username_canonical AS "pulseId", u.nickname,
          COALESCE(u.show_online_to_friends AND p.online_beat_at > ${ttlCutoffIso}, false) AS online,
          COALESCE(u.show_lobby_to_friends AND p.lobby_beat_at > ${ttlCutoffIso}, false) AS "inLobby",
          CASE WHEN ${viewerAnswered} THEN EXISTS (SELECT 1 FROM club.daily_challenge_attempts a
            WHERE a.user_id = u.id AND a.product_day = ${productDay}) END AS "answeredToday",
          ${avatarColumns(sql)}
        FROM identity.friendships f
        JOIN identity.users u
          ON u.id = CASE WHEN f.user_lo_id = ${viewerId} THEN f.user_hi_id ELSE f.user_lo_id END
        LEFT JOIN identity.presence_signals p ON p.user_id = u.id
        ${avatarJoin(sql)}
        WHERE (f.user_lo_id = ${viewerId} OR f.user_hi_id = ${viewerId})
          AND f.status = 'ACCEPTED' AND u.status = 'ACTIVE'
          AND ${blockedPairPredicate(sql, viewerId)}
        ORDER BY u.username_canonical`;
      const rows = joined.map(withAvatar);
      assertMinimalLobbyProjection(rows, FRIEND_ACTIVITY_PROJECTION_KEYS);
      return { viewerAnswered, friends: rows };
    },
  };
}

export type ClubChannelRepository = ReturnType<typeof createClubChannelRepository>;
