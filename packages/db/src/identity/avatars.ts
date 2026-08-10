import {
  AVATAR_CHANGES_PER_DAY,
  AVATAR_CHANGES_PER_HOUR,
  avatarMediaPath,
  type AvatarModerationStatus,
} from "@pulse/domain";
import type postgres from "postgres";

import { clearAvatarWithin, enqueueAvatarObjectDeletion, type PendingAvatarObject } from "./avatar-projection.js";
import { OperationError } from "../operations/repository.js";

/**
 * Avatar metadata storage (Story 12.6).
 *
 * The database owns three facts and nothing more: which object belongs to which
 * account, what that object is (type, size, dimensions, version), and which
 * objects still owe a delete. Image bytes never enter Postgres, and a temporary
 * CDN URL is never persisted — it expires, and a stored expired URL is worse than
 * no URL at all.
 *
 * Two invariants are enforced below the application, by the 0030 trigger:
 * `version` may only increase, and `public_id` may never be re-pointed. Both
 * matter because the public media path embeds them and is cached immutably.
 */
export type AvatarSql = postgres.Sql;

export interface AvatarRecord {
  userId: string;
  publicId: string;
  fileId: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
  version: number;
  moderationStatus: AvatarModerationStatus;
}

/** What the account page and the profile endpoint need. Never the object key. */
export interface AvatarSummary {
  avatarUrl: string;
  avatarVersion: number;
}

export interface SaveAvatarInput {
  userId: string;
  publicId: string;
  fileId: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
}

export function avatarSummary(record: Pick<AvatarRecord, "publicId" | "version">): AvatarSummary {
  return { avatarUrl: avatarMediaPath(record.publicId, record.version), avatarVersion: record.version };
}

const AVATAR_COLUMNS = (tx: postgres.ISql) => tx`
  user_id AS "userId", public_id AS "publicId", file_id AS "fileId", object_key AS "objectKey",
  content_type AS "contentType", byte_size AS "byteSize", width, height, version,
  moderation_status AS "moderationStatus"`;

export function createAvatarRepository(sql: AvatarSql, clock: () => Date = () => new Date()) {
  return {
    async getAvatar(userId: string): Promise<AvatarRecord | null> {
      const [row] = await sql<AvatarRecord[]>`
        SELECT ${AVATAR_COLUMNS(sql)} FROM identity.user_avatars WHERE user_id = ${userId} LIMIT 1`;
      return row ? normalize(row) : null;
    },

    /** Resolves the object behind a public media path. Only an APPROVED avatar is servable. */
    async getServableAvatar(publicId: string, version: number): Promise<AvatarRecord | null> {
      const [row] = await sql<AvatarRecord[]>`
        SELECT ${AVATAR_COLUMNS(sql)} FROM identity.user_avatars
        WHERE public_id = ${publicId} AND version = ${version} AND moderation_status = 'APPROVED'
        LIMIT 1`;
      return row ? normalize(row) : null;
    },

    /**
     * Prices one change attempt (5/h, 20/d) in its OWN committed transaction,
     * before the upload runs. Copied deliberately from the 0027 social-write
     * quota, for the same two reasons:
     *
     *  - the per-user advisory lock makes count-then-insert atomic, so N parallel
     *    requests cannot each read "4 so far" and all proceed;
     *  - committing separately means a later failure (a rejected file, a storage
     *    error) still costs its unit, so failed probing is not free.
     */
    async consumeAvatarChangeQuota(userId: string): Promise<void> {
      const now = clock();
      const nowIso = now.toISOString();
      const hourAgoIso = new Date(now.getTime() - 3_600_000).toISOString();
      const dayAgoIso = new Date(now.getTime() - 86_400_000).toISOString();
      await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended('avatar-change:' || ${userId}, 0))`;
        const [window] = await tx<Array<{ hourCount: string | number; dayCount: string | number }>>`
          SELECT count(*) FILTER (WHERE occurred_at >= ${hourAgoIso}) AS "hourCount", count(*) AS "dayCount"
          FROM identity.avatar_change_events
          WHERE user_id = ${userId} AND occurred_at >= ${dayAgoIso}`;
        if (
          Number(window?.hourCount ?? 0) >= AVATAR_CHANGES_PER_HOUR ||
          Number(window?.dayCount ?? 0) >= AVATAR_CHANGES_PER_DAY
        ) {
          throw new OperationError("RATE_LIMITED", 429);
        }
        await tx`INSERT INTO identity.avatar_change_events (user_id, occurred_at) VALUES (${userId}, ${nowIso})`;
      });
    },

    /**
     * Points the account at a freshly uploaded object. Insert on first upload,
     * version bump on replacement — and the predecessor is booked for deletion in
     * the same transaction, so a committed swap can never leave an orphan behind
     * even when the sweep that follows fails.
     *
     * Returns the previous object so the caller can attempt an immediate
     * best-effort delete instead of waiting for the sweeper.
     */
    async saveAvatar(input: SaveAvatarInput): Promise<{ record: AvatarRecord; replaced: PendingAvatarObject | null }> {
      const nowIso = clock().toISOString();
      return await sql.begin(async (tx) => {
        const [previous] = await tx<Array<PendingAvatarObject & { version: number }>>`
          SELECT object_key AS "objectKey", file_id AS "fileId", version
          FROM identity.user_avatars WHERE user_id = ${input.userId} FOR UPDATE`;

        const [row] = await tx<AvatarRecord[]>`
          INSERT INTO identity.user_avatars
            (user_id, public_id, file_id, object_key, content_type, byte_size, width, height, version,
             moderation_status, created_at, updated_at)
          VALUES
            (${input.userId}, ${input.publicId}, ${input.fileId}, ${input.objectKey}, ${input.contentType},
             ${input.byteSize}, ${input.width}, ${input.height}, 1,
             'APPROVED', ${nowIso}, ${nowIso})
          ON CONFLICT (user_id) DO UPDATE SET
            file_id = EXCLUDED.file_id,
            object_key = EXCLUDED.object_key,
            content_type = EXCLUDED.content_type,
            byte_size = EXCLUDED.byte_size,
            width = EXCLUDED.width,
            height = EXCLUDED.height,
            -- Computed from the stored row, not from EXCLUDED: the 0030 trigger
            -- refuses any version that does not move forward, and public_id is
            -- deliberately left out so the live media URL keeps resolving.
            version = identity.user_avatars.version + 1,
            moderation_status = 'APPROVED',
            updated_at = EXCLUDED.updated_at
          RETURNING ${AVATAR_COLUMNS(tx)}`;
        if (!row) throw new OperationError("AVATAR_SAVE_FAILED", 500);

        if (previous) await enqueueAvatarObjectDeletion(tx, previous, nowIso);
        return {
          record: normalize(row),
          replaced: previous ? { objectKey: previous.objectKey, fileId: previous.fileId } : null,
        };
      });
    },

    /**
     * Self-service delete. Idempotent: deleting when there is no avatar is a
     * success with `removed: false`, never a 404 — a retry after a dropped
     * response must not look like a failure.
     */
    async deleteAvatar(userId: string): Promise<{ removed: boolean; object: PendingAvatarObject | null }> {
      const nowIso = clock().toISOString();
      return await sql.begin(async (tx) => {
        const object = await clearAvatarWithin(tx, userId, nowIso);
        return { removed: object !== null, object };
      });
    },

    /** The sweeper's work list: objects whose delete is still owed, oldest first. */
    async listPendingAvatarObjects(limit = 50): Promise<PendingAvatarObject[]> {
      const safeLimit = Math.max(1, Math.min(limit, 200));
      return await sql<PendingAvatarObject[]>`
        SELECT object_key AS "objectKey", file_id AS "fileId"
        FROM identity.avatar_object_deletions
        WHERE deleted_at IS NULL
        ORDER BY enqueued_at ASC
        LIMIT ${safeLimit}`;
    },

    async markAvatarObjectDeleted(objectKey: string): Promise<void> {
      const nowIso = clock().toISOString();
      await sql`
        UPDATE identity.avatar_object_deletions
        SET deleted_at = ${nowIso}, last_attempt_at = ${nowIso}, attempts = attempts + 1
        WHERE object_key = ${objectKey} AND deleted_at IS NULL`;
    },

    async recordAvatarObjectDeleteFailure(objectKey: string): Promise<void> {
      const nowIso = clock().toISOString();
      await sql`
        UPDATE identity.avatar_object_deletions
        SET last_attempt_at = ${nowIso}, attempts = attempts + 1
        WHERE object_key = ${objectKey} AND deleted_at IS NULL`;
    },
  };
}

export type AvatarRepository = ReturnType<typeof createAvatarRepository>;

/** postgres.js hands integer columns back as numbers already; the coercion covers the string path. */
function normalize(row: AvatarRecord): AvatarRecord {
  return {
    ...row,
    byteSize: Number(row.byteSize),
    width: Number(row.width),
    height: Number(row.height),
    version: Number(row.version),
  };
}
