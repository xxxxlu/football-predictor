import { avatarProjection, NO_AVATAR, type AvatarProjection } from "@pulse/domain";
import type postgres from "postgres";

/**
 * The read-side of avatars: the SQL fragments every avatar-bearing projection
 * shares, the mappers that turn them into the public pair, and the two writes
 * that must be callable from anywhere an account loses its photo.
 *
 * Kept separate from `avatars.ts` on purpose. The operations repository needs
 * these fragments, and `avatars.ts` needs `OperationError` from the operations
 * repository — importing them from one module would close a cycle between the
 * identity and operations halves of this package.
 */

/** A storage object whose delete is still owed. */
export interface PendingAvatarObject {
  objectKey: string;
  fileId: string | null;
}

/**
 * The join every avatar-bearing projection shares. It expects the identity row
 * to be aliased `u` — the convention every social/club/chat read already follows
 * — and it only ever admits an APPROVED avatar, so an operator takedown takes
 * effect on the very next read without touching any of these queries.
 */
export const avatarJoin = (tx: postgres.ISql) => tx`
  LEFT JOIN identity.user_avatars av ON av.user_id = u.id AND av.moderation_status = 'APPROVED'`;

/**
 * The same join, plus: never serve the viewer a photo of somebody the viewer has
 * blocked. Used on surfaces that deliberately keep showing the *row* under a
 * block — room chat (the 12.3 decision that messages must not vanish), room
 * results, the leaderboard and the submission wall.
 *
 * The condition is viewer-directional on purpose, exactly like the 12.1 request
 * filter. Suppressing in the other direction — hiding a blocker's photo from the
 * person they blocked — would make an avatar disappear from a pane where it used
 * to be, which is precisely the "you have been blocked" signal AC2 forbids.
 */
export const avatarJoinUnlessViewerBlocked = (tx: postgres.ISql, viewerId: string) => tx`
  LEFT JOIN identity.user_avatars av ON av.user_id = u.id AND av.moderation_status = 'APPROVED'
    AND NOT EXISTS (SELECT 1 FROM identity.user_blocks b
      WHERE b.blocker_user_id = ${viewerId} AND b.blocked_user_id = u.id)`;

/** The two columns that join reads. Never the object key — that stays server-side. */
export const avatarColumns = (tx: postgres.ISql) => tx`
  av.public_id AS "avatarPublicId", av.version AS "avatarVersion"`;

interface AvatarJoinRow {
  avatarPublicId?: string | null;
  avatarVersion?: number | string | null;
}

/**
 * Turns the joined columns into the public pair. `avatarPublicId` is dropped on
 * the way out: it is the URL's building block, not a field a client receives, and
 * leaving it in would trip every minimal-projection guard — which is exactly the
 * behaviour we want if someone forgets to map.
 */
export function withAvatar<T extends AvatarJoinRow>(row: T): Omit<T, "avatarPublicId" | "avatarVersion"> & AvatarProjection {
  const { avatarPublicId: _publicId, avatarVersion: _version, ...rest } = row;
  return { ...rest, ...avatarProjection(row) } as Omit<T, "avatarPublicId" | "avatarVersion"> & AvatarProjection;
}

/**
 * Same shape, avatar suppressed. Used wherever a block must stop serving a
 * photo — and also where a read deliberately never joins one at all (the block
 * list), so the constraint is `object`, not `AvatarJoinRow`: requiring the join
 * columns would force a caller to select an avatar just to throw it away.
 */
export function withoutAvatar<T extends object>(row: T): Omit<T, "avatarPublicId" | "avatarVersion"> & AvatarProjection {
  const { avatarPublicId: _publicId, avatarVersion: _version, ...rest } = row as T & AvatarJoinRow;
  return { ...rest, ...NO_AVATAR } as Omit<T, "avatarPublicId" | "avatarVersion"> & AvatarProjection;
}

/** The message-author variant: same pair, prefixed to match the chat projections. */
export function withAuthorAvatar<T extends AvatarJoinRow>(
  row: T,
): Omit<T, "avatarPublicId" | "avatarVersion"> & { authorAvatarUrl: string | null; authorAvatarVersion: number | null } {
  const { avatarPublicId: _publicId, avatarVersion: _version, ...rest } = row;
  const projection = avatarProjection(row);
  return { ...rest, authorAvatarUrl: projection.avatarUrl, authorAvatarVersion: projection.avatarVersion } as Omit<
    T,
    "avatarPublicId" | "avatarVersion"
  > & { authorAvatarUrl: string | null; authorAvatarVersion: number | null };
}

/**
 * Enqueues one object for deletion. Idempotent on the object key: a replay never
 * creates a second row, and an object already swept stays swept.
 */
export async function enqueueAvatarObjectDeletion(
  tx: postgres.ISql,
  object: PendingAvatarObject,
  nowIso: string,
): Promise<void> {
  await tx`
    INSERT INTO identity.avatar_object_deletions (object_key, file_id, enqueued_at)
    VALUES (${object.objectKey}, ${object.fileId}, ${nowIso})
    ON CONFLICT (object_key) DO NOTHING`;
}

/**
 * Drops an account's avatar row inside a caller's transaction and books the
 * object for deletion. Used by the self-service delete, the operator takedown and
 * the anonymization routine, so those three can never drift on the "the bucket
 * copy must go too" rule.
 */
export async function clearAvatarWithin(
  tx: postgres.ISql,
  userId: string,
  nowIso: string,
): Promise<PendingAvatarObject | null> {
  const [row] = await tx<Array<PendingAvatarObject>>`
    DELETE FROM identity.user_avatars WHERE user_id = ${userId}
    RETURNING object_key AS "objectKey", file_id AS "fileId"`;
  if (!row) return null;
  await enqueueAvatarObjectDeletion(tx, row, nowIso);
  return row;
}
