import {
  assertMinimalClubProjection,
  badgesEarned,
  CHALLENGE_BANK_VERSION,
  CLUB_RESULT_PROJECTION_KEYS,
  isCorrectAnswer,
  nextStreak,
  questionForProductDay,
  XP_RULES_VERSION,
  xpForAnswer,
  type BadgeKey,
  type ChallengeOptionKey,
} from "@pulse/domain";
import type postgres from "postgres";

import { isUniqueViolation } from "../identity/repository.js";
import { OperationError } from "../operations/repository.js";

/**
 * Club daily challenge storage (Story 12.2). Submission is replay-first with
 * the (user_id, product_day) unique constraint as the final arbiter: a repeat
 * or concurrent cross-device submit converges on the same recorded attempt and
 * never re-awards anything (AC1).
 *
 * Isolation (AC4): club tables are only ever joined to identity.users. The
 * room-results read authorizes membership against room.members in a separate
 * query and never joins room/prediction/ledger relations into a club payload.
 */
export type ClubSql = postgres.Sql;

export interface AttemptRecord {
  productDay: string;
  questionKey: string;
  answer: ChallengeOptionKey;
  isCorrect: boolean;
  xpAwarded: number;
  streakAfter: number;
}

export interface EngagementSnapshot {
  xpTotal: number;
  currentStreak: number;
  bestStreak: number;
  lastAnsweredDay: string | null;
}

export interface DailyResultRow {
  pulseId: string;
  nickname: string | null;
  answered: boolean;
  correct: boolean | null;
  streak: number;
}

const EMPTY_PROFILE: EngagementSnapshot = { xpTotal: 0, currentStreak: 0, bestStreak: 0, lastAnsweredDay: null };

const ATTEMPT_COLUMNS = (sql: postgres.ISql) => sql`
  product_day::text AS "productDay", question_key AS "questionKey", answer,
  is_correct AS "isCorrect", xp_awarded AS "xpAwarded", streak_after AS "streakAfter"`;

export function createClubRepository(sql: ClubSql) {
  async function readAttempt(tx: postgres.ISql, userId: string, day: string): Promise<AttemptRecord | null> {
    const [row] = await tx<AttemptRecord[]>`
      SELECT ${ATTEMPT_COLUMNS(tx)} FROM club.daily_challenge_attempts
      WHERE user_id = ${userId} AND product_day = ${day} LIMIT 1`;
    return row ?? null;
  }

  async function readProfile(tx: postgres.ISql, userId: string): Promise<EngagementSnapshot> {
    const [row] = await tx<EngagementSnapshot[]>`
      SELECT xp_total AS "xpTotal", current_streak AS "currentStreak", best_streak AS "bestStreak",
        last_answered_day::text AS "lastAnsweredDay"
      FROM club.engagement_profiles WHERE user_id = ${userId} LIMIT 1`;
    return row ?? EMPTY_PROFILE;
  }

  async function readBadges(tx: postgres.ISql, userId: string): Promise<BadgeKey[]> {
    const rows = await tx<Array<{ badgeKey: BadgeKey }>>`
      SELECT badge_key AS "badgeKey" FROM club.badge_awards
      WHERE user_id = ${userId} ORDER BY awarded_at`;
    return rows.map((row) => row.badgeKey);
  }

  async function submitOnce(userId: string, day: string, answer: ChallengeOptionKey) {
    return await sql.begin(async (tx) => {
      // Serialize submits per user: the profile FOR UPDATE below locks nothing
      // when no profile row exists yet, so two first-ever submits straddling a
      // day boundary would both read an empty streak snapshot. Same recipe as
      // the chat send and the 0027 social-quota lock — transaction-scoped.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('club-daily:' || ${userId}, 0))`;
      // Replay-first: the natural key (user, product day) makes retries and
      // cross-device repeats return the recorded attempt without re-awarding.
      const existing = await readAttempt(tx, userId, day);
      if (existing) {
        return { replayed: true as const, attempt: existing, profile: await readProfile(tx, userId), newBadges: [] as BadgeKey[] };
      }

      const question = questionForProductDay(day);
      const correct = isCorrectAnswer(question, answer);
      const [profileRow] = await tx<Array<{ currentStreak: number; lastAnsweredDay: string | null }>>`
        SELECT current_streak AS "currentStreak", last_answered_day::text AS "lastAnsweredDay"
        FROM club.engagement_profiles WHERE user_id = ${userId} FOR UPDATE`;
      const streakAfter = nextStreak({
        lastAnsweredDay: profileRow?.lastAnsweredDay ?? null,
        currentStreak: profileRow?.currentStreak ?? 0,
        day,
        correct,
      });
      const xpAwarded = xpForAnswer(correct, streakAfter);

      const [attempt] = await tx<AttemptRecord[]>`
        INSERT INTO club.daily_challenge_attempts
          (user_id, product_day, question_key, bank_version, xp_rules_version, answer, is_correct, xp_awarded, streak_after)
        VALUES (${userId}, ${day}, ${question.key}, ${CHALLENGE_BANK_VERSION}, ${XP_RULES_VERSION}, ${answer}, ${correct}, ${xpAwarded}, ${streakAfter})
        RETURNING ${ATTEMPT_COLUMNS(tx)}`;

      const [profile] = await tx<EngagementSnapshot[]>`
        INSERT INTO club.engagement_profiles (user_id, xp_total, current_streak, best_streak, last_answered_day)
        VALUES (${userId}, ${xpAwarded}, ${streakAfter}, ${streakAfter}, ${day})
        ON CONFLICT (user_id) DO UPDATE SET
          xp_total = club.engagement_profiles.xp_total + ${xpAwarded},
          current_streak = ${streakAfter},
          best_streak = GREATEST(club.engagement_profiles.best_streak, ${streakAfter}),
          last_answered_day = ${day},
          updated_at = now()
        RETURNING xp_total AS "xpTotal", current_streak AS "currentStreak", best_streak AS "bestStreak",
          last_answered_day::text AS "lastAnsweredDay"`;

      const newBadges: BadgeKey[] = [];
      for (const badge of badgesEarned({ isFirstAnswer: !profileRow, streakAfter })) {
        const granted = await tx<Array<{ badgeKey: BadgeKey }>>`
          INSERT INTO club.badge_awards (user_id, badge_key) VALUES (${userId}, ${badge})
          ON CONFLICT (user_id, badge_key) DO NOTHING
          RETURNING badge_key AS "badgeKey"`;
        if (granted.length > 0) newBadges.push(badge);
      }

      return { replayed: false as const, attempt: attempt as AttemptRecord, profile: profile as EngagementSnapshot, newBadges };
    });
  }

  return {
    /** Own state for the daily page: attempt (if any), profile, badge keys. */
    async getDailyState(userId: string, day: string) {
      const [attempt, profile, badges] = await Promise.all([
        readAttempt(sql, userId, day),
        readProfile(sql, userId),
        readBadges(sql, userId),
      ]);
      return { attempt, profile, badges };
    },

    /**
     * Submits the official answer for the day. A 23505 from a concurrent
     * double-submit aborts the transaction, so the whole thing re-runs once
     * and the replay-first read returns the winner's row.
     */
    async submitAttempt(userId: string, day: string, answer: ChallengeOptionKey) {
      try {
        return await submitOnce(userId, day, answer);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return await submitOnce(userId, day, answer);
      }
    },

    /**
     * Friends' results for a product day. Callers gate visibility (viewer
     * answered, or the day is over) before this runs; relationship and block
     * suppression reuse the Story 12.1 read shape.
     */
    async listFriendResults(userId: string, day: string): Promise<DailyResultRow[]> {
      const rows = await sql<DailyResultRow[]>`
        SELECT u.username_canonical AS "pulseId", u.nickname,
          (a.id IS NOT NULL) AS answered, a.is_correct AS correct,
          COALESCE(p.current_streak, 0) AS streak
        FROM identity.friendships f
        JOIN identity.users u
          ON u.id = CASE WHEN f.user_lo_id = ${userId} THEN f.user_hi_id ELSE f.user_lo_id END
        LEFT JOIN club.daily_challenge_attempts a ON a.user_id = u.id AND a.product_day = ${day}
        LEFT JOIN club.engagement_profiles p ON p.user_id = u.id
        WHERE (f.user_lo_id = ${userId} OR f.user_hi_id = ${userId})
          AND f.status = 'ACCEPTED' AND u.status = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1 FROM identity.user_blocks b
            WHERE (b.blocker_user_id = ${userId} AND b.blocked_user_id = u.id)
               OR (b.blocker_user_id = u.id AND b.blocked_user_id = ${userId}))
        ORDER BY u.username_canonical`;
      assertMinimalClubProjection(rows, CLUB_RESULT_PROJECTION_KEYS);
      return rows;
    },

    /**
     * Room members' results. Membership is authorized first (assertMember
     * shape); the roster is read from room.members separately, and the club
     * join touches identity + club relations only.
     */
    async listRoomResults(userId: string, roomId: string, day: string): Promise<DailyResultRow[]> {
      const [membership] = await sql<Array<{ role: string }>>`
        SELECT role FROM room.members WHERE room_id = ${roomId} AND user_id = ${userId} LIMIT 1`;
      if (!membership) throw new OperationError("ROOM_NOT_FOUND", 404);
      const rows = await sql<DailyResultRow[]>`
        SELECT u.username_canonical AS "pulseId", u.nickname,
          (a.id IS NOT NULL) AS answered, a.is_correct AS correct,
          COALESCE(p.current_streak, 0) AS streak
        FROM room.members m
        JOIN identity.users u ON u.id = m.user_id
        LEFT JOIN club.daily_challenge_attempts a ON a.user_id = u.id AND a.product_day = ${day}
        LEFT JOIN club.engagement_profiles p ON p.user_id = u.id
        WHERE m.room_id = ${roomId} AND u.status = 'ACTIVE' AND u.id <> ${userId}
        ORDER BY u.username_canonical`;
      assertMinimalClubProjection(rows, CLUB_RESULT_PROJECTION_KEYS);
      return rows;
    },

    /** Whether the viewer has an official attempt for the day (the AC2 gate). */
    async hasAttempted(userId: string, day: string): Promise<boolean> {
      const rows = await sql<Array<{ present: number }>>`
        SELECT 1 AS present FROM club.daily_challenge_attempts
        WHERE user_id = ${userId} AND product_day = ${day} LIMIT 1`;
      return rows.length > 0;
    },
  };
}

export type ClubRepository = ReturnType<typeof createClubRepository>;
