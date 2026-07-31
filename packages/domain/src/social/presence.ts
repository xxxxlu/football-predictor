/**
 * Short-lived presence (Story 12.1, FR85).
 *
 * Presence is a heartbeat row filtered by TTL at read time — never a value
 * derived from `identity.sessions.last_seen_at`, which is written on every
 * authenticated request regardless of consent. Both display toggles default to
 * OFF at the database layer; this module only encodes the read-side judgement.
 */

import type { FriendshipStatus } from "./friendship.js";

/**
 * 90 seconds: 1.5–3× the client's 30–60s polling cadence, so one missed poll
 * does not flicker a friend offline while a closed tab goes dark quickly.
 */
export const PRESENCE_TTL_MS = 90_000;

export interface PresencePreferences {
  showOnlineToFriends: boolean;
  showLobbyToFriends: boolean;
}

export const DEFAULT_PRESENCE_PREFERENCES: PresencePreferences = {
  showOnlineToFriends: false,
  showLobbyToFriends: false,
};

export function isPresenceFresh(beatAt: Date | null | undefined, now: Date, ttlMs: number = PRESENCE_TTL_MS): boolean {
  return beatAt instanceof Date && now.getTime() - beatAt.getTime() < ttlMs;
}

/**
 * The four conditions of FR85, all mandatory: an ACCEPTED friendship, no block
 * in either direction, the target's own opt-in, and a signal still inside the
 * TTL. Failing any one of them reads as "offline" — never as an error, so the
 * response shape leaks nothing about which condition failed.
 */
export function presenceVisibleTo(input: {
  friendshipStatus: FriendshipStatus | null;
  blocked: boolean;
  targetOptedIn: boolean;
  beatAt: Date | null;
  now: Date;
  ttlMs?: number;
}): boolean {
  return (
    input.friendshipStatus === "ACCEPTED" &&
    !input.blocked &&
    input.targetOptedIn &&
    isPresenceFresh(input.beatAt, input.now, input.ttlMs ?? PRESENCE_TTL_MS)
  );
}
