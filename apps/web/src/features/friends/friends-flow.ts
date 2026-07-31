/**
 * Pure view logic for the friends feature (Story 12.1). Everything a test
 * needs to cover lives here — the .tsx view stays a thin renderer because the
 * vitest root config does not pick up .test.tsx files.
 */

export interface FriendEntry {
  userId: string;
  pulseId: string;
  nickname: string | null;
  online: boolean;
}

export interface FriendRequestEntry {
  requestId: string;
  direction: "INCOMING" | "OUTGOING";
  /** The counterpart's id — requester-side withdrawal is DELETE /friends/{userId}. */
  userId: string;
  pulseId: string;
  nickname: string | null;
  createdAt: string;
}

export interface BlockEntry {
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
export function requestOutcomeMessage(status: "PENDING" | "ACCEPTED"): string {
  return status === "ACCEPTED" ? "对方也向你发过申请，你们已互为好友。" : "申请已发送。对方接受后会出现在你的好友列表。";
}

export function friendErrorMessage(code: string | undefined): string {
  switch (code) {
    case "USER_NOT_FOUND": return "没有找到这个 PULSE ID 对应的成员。";
    case "SELF_FRIEND_FORBIDDEN": return "不能添加自己为好友。";
    case "SELF_BLOCK_FORBIDDEN": return "不能屏蔽自己。";
    case "RATE_LIMITED": return "好友申请发送过于频繁，请稍后再试。";
    case "REQUEST_NOT_FOUND": return "这条好友申请不存在或已被处理。";
    case "INVALID_REQUEST": return "请检查输入后重试。";
    case "UNAUTHENTICATED": return "请先登录。";
    default: return "操作未能完成，请稍后重试。";
  }
}

/** Poll/heartbeat cadence: inside the 30–60s window the presence TTL (90s) expects. */
export const FRIENDS_POLL_INTERVAL_MS = 45_000;

/** The client only beats when a toggle is on; the server re-checks regardless. */
export function shouldSendHeartbeat(preferences: PrivacyPreferences | null): boolean {
  return Boolean(preferences && (preferences.showOnlineToFriends || preferences.showLobbyToFriends));
}
