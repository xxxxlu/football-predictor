/**
 * PULSE CLUB lobby client flow (Story 12.4, FR89). Pure module: request
 * builders and the channel bookkeeping live here so they are testable without
 * React. The optimistic-send helpers are the 12.3 chat helpers, reused as-is.
 *
 * Types mirror the server projections structurally — this module never imports
 * @pulse/domain (the 12.2 precedent: the domain barrel pulls node-only modules).
 */

export {
  appendPending,
  CHAT_MESSAGE_MAX,
  CHAT_POLL_INTERVAL_MS,
  chatErrorKey,
  chatMessageLength,
  dropDeliveredPending,
  failPending,
  isMutedNow,
  normalizeChatInput,
  reconcileMessages,
  removePending,
  retryPending,
  type PendingMessage,
} from "../rooms/room-chat-flow";

export type ChannelMessageRecord = {
  id: string;
  authorPulseId: string;
  authorNickname: string | null;
  /** Story 12.6: same-origin media path, null when the author has no avatar. */
  authorAvatarUrl?: string | null;
  authorAvatarVersion?: number | null;
  body: string;
  createdAt: string;
};

export type ChannelPageRecord = {
  messages: ChannelMessageRecord[];
  mutedUntil: string | null;
  rulesConfirmed: boolean;
};

export type DirectoryEntry = { pulseId: string; nickname: string | null; avatarUrl?: string | null; avatarVersion?: number | null };

export type FriendActivityEntry = {
  pulseId: string;
  nickname: string | null;
  avatarUrl?: string | null;
  avatarVersion?: number | null;
  online: boolean;
  /** The friend opted into 向好友展示「正在大厅」 and their lobby beat is fresh. */
  inLobby: boolean;
  /** null until the viewer has answered today's challenge (the 12.2 mutual gate). */
  answeredToday: boolean | null;
};

export type LobbyData = {
  day: string;
  directory: DirectoryEntry[] | null;
  friends: { viewerAnswered: boolean; friends: FriendActivityEntry[] } | null;
  channel: ChannelPageRecord | null;
  failedSections: string[];
};

/** Lobby presence cadence: comfortably inside the server's 90s TTL. */
export const LOBBY_HEARTBEAT_INTERVAL_MS = 45_000;

/**
 * Directory/friends refresh cadence. Presence has a 90s server-side TTL, so a
 * lobby left open must re-read these sections or it shows people who left
 * long ago (and the section copy promises automatic recovery after a failure).
 */
export const LOBBY_SECTIONS_REFRESH_MS = 60_000;

const json = (body: unknown, method: string) => ({
  method,
  headers: { "Content-Type": "application/json" },
  credentials: "same-origin" as const,
  body: JSON.stringify(body),
});

export function lobbyRequest() {
  return { url: "/api/v1/club/lobby", init: { credentials: "same-origin" as const } };
}

export function listChannelRequest(cursor?: string) {
  const base = "/api/v1/club/channel/messages";
  return { url: cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base, init: { credentials: "same-origin" as const } };
}

export function sendChannelRequest(body: string) {
  return { url: "/api/v1/club/channel/messages", init: json({ body }, "POST") };
}

export function reportChannelMessageRequest(messageId: string, reason: string) {
  return { url: `/api/v1/club/channel/messages/${encodeURIComponent(messageId)}/reports`, init: json({ reason }, "POST") };
}

export function acceptCommunityRulesRequest() {
  return { url: "/api/v1/club/rules-acceptance", init: json({}, "POST") };
}

/** The 12.1 heartbeat endpoint, declaring the lobby surface (12.4). */
export function lobbyHeartbeatRequest() {
  return { url: "/api/v1/presence/heartbeat", init: json({ surface: "lobby" }, "POST") };
}

/** Insert a just-confirmed channel message at the newest end without duplicating it. */
export function mergeConfirmedChannelMessage(messages: ChannelMessageRecord[], confirmed: ChannelMessageRecord): ChannelMessageRecord[] {
  if (messages.some((message) => message.id === confirmed.id)) return messages;
  return [confirmed, ...messages];
}
