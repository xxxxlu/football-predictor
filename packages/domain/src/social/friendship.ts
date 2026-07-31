/**
 * Friendship state machine (Story 12.1, FR84).
 *
 * The persisted model is one row per user pair in canonical order
 * (`user_lo_id < user_hi_id`) so the pair unique constraint — not application
 * code — is the final arbiter against duplicate or concurrent relationships.
 * Blocks live in their own directional table and OUTRANK every relationship
 * action: a block in either direction suppresses discovery, requests and
 * responses without ever telling the blocked side that a block exists.
 */

export { canonicalUsername as normalizePulseId } from "../identity/service.js";

export const FRIENDSHIP_STATUSES = ["PENDING", "ACCEPTED"] as const;
export type FriendshipStatus = (typeof FRIENDSHIP_STATUSES)[number];

/** Persisted-counter thresholds for friend-request creation (anti-enumeration + spam). */
export const FRIEND_REQUESTS_PER_HOUR = 10;
export const FRIEND_REQUESTS_PER_DAY = 50;

export interface CanonicalPair {
  loUserId: string;
  hiUserId: string;
}

/** Orders a user pair for the single-row-per-pair storage model. */
export function canonicalPair(a: string, b: string): CanonicalPair {
  if (a === b) throw new Error("a friendship pair needs two distinct users");
  return a < b ? { loUserId: a, hiUserId: b } : { loUserId: b, hiUserId: a };
}

export interface FriendshipSnapshot {
  status: FriendshipStatus;
  requestedBy: string;
}

/**
 * What a friend request must do to storage. `SUPPRESS` is the block outcome:
 * the caller answers exactly as if a fresh request had been created, but writes
 * nothing — the blocked side must not be able to distinguish "blocked" from
 * "requested and pending" through any response shape (AC2).
 */
export type FriendRequestDecision =
  | { kind: "CREATE" }
  | { kind: "ACCEPT" }
  | { kind: "NOOP"; status: FriendshipStatus }
  | { kind: "SUPPRESS" };

export function decideFriendRequest(input: {
  requesterId: string;
  targetId: string;
  existing: FriendshipSnapshot | null;
  blocked: boolean;
}): FriendRequestDecision {
  if (input.requesterId === input.targetId) throw new Error("a user cannot friend themselves");
  if (input.blocked) return { kind: "SUPPRESS" };
  if (!input.existing) return { kind: "CREATE" };
  if (input.existing.status === "ACCEPTED") return { kind: "NOOP", status: "ACCEPTED" };
  // PENDING: a repeat from the same requester replays; a request from the other
  // side is mutual intent and completes the handshake.
  if (input.existing.requestedBy === input.requesterId) return { kind: "NOOP", status: "PENDING" };
  return { kind: "ACCEPT" };
}

export const RESPOND_ACTIONS = ["accept", "decline"] as const;
export type RespondAction = (typeof RESPOND_ACTIONS)[number];

/** Only the recipient of a still-pending request may accept or decline it. */
export function canRespondToRequest(input: {
  responderId: string;
  requestedBy: string;
  status: FriendshipStatus;
}): boolean {
  return input.status === "PENDING" && input.requestedBy !== input.responderId;
}
