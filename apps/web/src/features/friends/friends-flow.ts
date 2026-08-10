/**
 * Pure view logic for the friends feature (Story 12.1). Everything a test
 * needs to cover lives here — the .tsx view stays a thin renderer because the
 * vitest root config does not pick up .test.tsx files.
 */

import type { MessageKey } from "@/lib/i18n/messages";

/** Story 12.6: every friend-facing row carries the same optional avatar pair. */
export interface AvatarFields {
  avatarUrl?: string | null;
  avatarVersion?: number | null;
}

export interface FriendEntry extends AvatarFields {
  userId: string;
  pulseId: string;
  nickname: string | null;
  online: boolean;
}

export interface FriendRequestEntry extends AvatarFields {
  requestId: string;
  direction: "INCOMING" | "OUTGOING";
  /** The counterpart's id — requester-side withdrawal is DELETE /friends/{userId}. */
  userId: string;
  pulseId: string;
  nickname: string | null;
  createdAt: string;
}

/**
 * A blocked account's row never carries a photo — the server sends nulls, and the
 * list renders the muted initials fallback instead.
 */
export interface BlockEntry extends AvatarFields {
  userId: string;
  pulseId: string;
  nickname: string | null;
  createdAt: string;
}

export interface PrivacyPreferences {
  showOnlineToFriends: boolean;
  showLobbyToFriends: boolean;
}

export const PULSE_ID_PATTERN = /^[a-z0-9_]{3,32}$/;

/** Mirrors the server's PULSE ID normalization so the form can validate before submitting. */
export function normalizePulseIdInput(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  return PULSE_ID_PATTERN.test(normalized) ? normalized : null;
}

export function splitRequests(requests: FriendRequestEntry[]): {
  incoming: FriendRequestEntry[];
  outgoing: FriendRequestEntry[];
} {
  return {
    incoming: requests.filter((request) => request.direction === "INCOMING"),
    outgoing: requests.filter((request) => request.direction === "OUTGOING"),
  };
}

/**
 * The request outcome copy deliberately reads the same whether the target is
 * reachable or has blocked the caller: the server answers PENDING for both,
 * and the wording promises nothing about the other side (AC2).
 */
export function requestOutcomeKey(status: "PENDING" | "ACCEPTED"): MessageKey {
  return status === "ACCEPTED" ? "friends.outcomeAccepted" : "friends.outcomePending";
}

/**
 * Business rejections arrive as stable error codes; the UI renders them
 * through i18n, never hardcoded copy — the same discipline as chatErrorKey.
 */
export function friendErrorKey(code: string | undefined): MessageKey {
  switch (code) {
    case "USER_NOT_FOUND": return "friends.err.USER_NOT_FOUND";
    case "SELF_FRIEND_FORBIDDEN": return "friends.err.SELF_FRIEND_FORBIDDEN";
    case "SELF_BLOCK_FORBIDDEN": return "friends.err.SELF_BLOCK_FORBIDDEN";
    case "RATE_LIMITED": return "friends.err.RATE_LIMITED";
    case "REQUEST_NOT_FOUND": return "friends.err.REQUEST_NOT_FOUND";
    case "INVALID_REQUEST": return "friends.err.INVALID_REQUEST";
    case "UNAUTHENTICATED": return "friends.err.UNAUTHENTICATED";
    default: return "friends.err.generic";
  }
}

/** Poll/heartbeat cadence: inside the 30–60s window the presence TTL (90s) expects. */
export const FRIENDS_POLL_INTERVAL_MS = 45_000;

/** The client only beats when a toggle is on; the server re-checks regardless. */
export function shouldSendHeartbeat(preferences: PrivacyPreferences | null): boolean {
  return Boolean(preferences && (preferences.showOnlineToFriends || preferences.showLobbyToFriends));
}
