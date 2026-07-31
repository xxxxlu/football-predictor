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

/**
 * Same mechanism for block creation: `POST /blocks` also resolves a PULSE ID,
 * so an unthrottled block path would be a free existence oracle around the
 * friend-request quota. Roomier than requests — mass-blocking a spam wave is
 * legitimate — but bounded, and attempts count whether or not the ID resolves.
 */
export const BLOCKS_PER_HOUR = 30;
export const BLOCKS_PER_DAY = 100;

/** Vocabulary for the shared social-write quota ledger (identity.friend_request_events.kind). */
export const SOCIAL_WRITE_KINDS = ["FRIEND_REQUEST", "BLOCK"] as const;
export type SocialWriteKind = (typeof SOCIAL_WRITE_KINDS)[number];

export interface CanonicalPair {
  loUserId: string;
  hiUserId: string;
}

/**
 * Orders a user pair for the single-row-per-pair storage model. UUIDs are
 * case-insensitive (RFC 4122) and Postgres stores them lowercase, so both ids
 * are lowercased first — a mixed-case id from a route param must land on the
 * same (lo, hi) assignment as the stored row, or a DELETE silently matches
 * nothing.
 */
export function canonicalPair(a: string, b: string): CanonicalPair {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA === lowerB) throw new Error("a friendship pair needs two distinct users");
  return lowerA < lowerB ? { loUserId: lowerA, hiUserId: lowerB } : { loUserId: lowerB, hiUserId: lowerA };
}

export interface FriendshipSnapshot {
  status: FriendshipStatus;
  requestedBy: string;
}

/**
 * What a friend request must do to storage. A block hides but does not change
 * the write: the request row is created (or replayed) exactly as on the normal
 * path, and stays invisible to the blocker through the viewer-directional list
 * filter and the respond-path re-check. Anything else — writing nothing, or a
 * different response shape — leaves the requester's own outbox observably
 * different from a real pending request, which is the distinguishable signal
 * AC2 forbids. The one thing a block does change: it never completes a
 * handshake, so a request from the other side stays PENDING instead of
 * auto-accepting.
 */
export type FriendRequestDecision =
  | { kind: "CREATE" }
  | { kind: "ACCEPT" }
  | { kind: "NOOP"; status: FriendshipStatus };

export function decideFriendRequest(input: {
  requesterId: string;
  targetId: string;
  existing: FriendshipSnapshot | null;
  blocked: boolean;
}): FriendRequestDecision {
  if (input.requesterId === input.targetId) throw new Error("a user cannot friend themselves");
  if (input.blocked) {
    // Never ACCEPT across a block; the answer is always PENDING-shaped.
    return input.existing ? { kind: "NOOP", status: "PENDING" } : { kind: "CREATE" };
  }
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
