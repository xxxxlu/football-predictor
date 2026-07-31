import type postgres from "postgres";

/**
 * Closes out mute windows that have already run out (deferred-work gap ③,
 * Story 12.3). The "one live mute" partial unique index keys on
 * `lifted_at IS NULL`, but nothing sweeps expired rows — so before inserting a
 * new mute, both write paths (governance inbox MUTE_MEMBER and the room-owner
 * mute) settle any expired window for that member. `lifted_at = muted_until`
 * records that the window simply ran out; no `lifted_by`, nobody intervened.
 *
 * Read paths must still gate on `muted_until > now()` themselves — an expired
 * row can exist whenever neither write path has run since it lapsed.
 */
export async function closeExpiredMuteWindows(tx: postgres.ISql, roomId: string, userId: string, nowIso: string): Promise<void> {
  await tx`UPDATE room.member_mutes SET lifted_at = muted_until
    WHERE room_id = ${roomId} AND user_id = ${userId} AND lifted_at IS NULL AND muted_until <= ${nowIso}`;
}
