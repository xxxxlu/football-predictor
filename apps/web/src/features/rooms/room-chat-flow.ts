/**
 * Room public chat client flow (Story 12.3, FR88). Pure module: request
 * builders, code-point validation and the optimistic-send bookkeeping live
 * here so they are testable without React.
 *
 * Types mirror the server projection structurally — this module must stay
 * importable from client components, so it never imports @pulse/domain
 * (the 12.2 precedent: the domain barrel pulls node-only modules).
 */

import type { MessageKey } from "@/lib/i18n/messages";

export type ChatMessageRecord = {
  id: string;
  authorPulseId: string;
  authorNickname: string | null;
  body: string;
  createdAt: string;
  isPinned: boolean;
};

export type OwnerMuteRecord = {
  muteId: string;
  pulseId: string;
  nickname: string | null;
  mutedUntil: string;
};

export type ChatPageRecord = {
  messages: ChatMessageRecord[];
  pinned: ChatMessageRecord | null;
  mutedUntil: string | null;
  canPost: boolean;
  isOwner: boolean;
  mutes?: OwnerMuteRecord[];
};

export type PendingMessage = {
  localId: string;
  body: string;
  createdAt: string;
  status: "sending" | "failed";
  error?: string;
};

/** Visible-page polling cadence — the story allows 15–30s. */
export const CHAT_POLL_INTERVAL_MS = 20_000;
/** Client-side hint only; the server counts code points and is authoritative. */
export const CHAT_MESSAGE_MAX = 500;

/** Code-point length, the same unit the server's char_length CHECK counts. */
export function chatMessageLength(value: string): number {
  return [...value].length;
}

/** Trimmed body if sendable, otherwise null (empty or over the limit). */
export function normalizeChatInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return chatMessageLength(trimmed) <= CHAT_MESSAGE_MAX ? trimmed : null;
}

const json = (body: unknown, method: string) => ({
  method,
  headers: { "Content-Type": "application/json" },
  credentials: "same-origin" as const,
  body: JSON.stringify(body),
});

export function listChatRequest(roomId: string, cursor?: string) {
  const base = `/api/v1/rooms/${encodeURIComponent(roomId)}/messages`;
  return { url: cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base, init: { credentials: "same-origin" as const } };
}

export function sendChatRequest(roomId: string, body: string) {
  return { url: `/api/v1/rooms/${encodeURIComponent(roomId)}/messages`, init: json({ body }, "POST") };
}

export function pinChatRequest(roomId: string, messageId: string) {
  return { url: `/api/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/pin`, init: json({}, "POST") };
}

export function unpinChatRequest(roomId: string, messageId: string) {
  return { url: `/api/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/pin`, init: { method: "DELETE", credentials: "same-origin" as const } };
}

export function muteMemberRequest(roomId: string, input: { memberUserId: string; muteHours: number; reason: string }) {
  return { url: `/api/v1/rooms/${encodeURIComponent(roomId)}/mutes`, init: json(input, "POST") };
}

export function unmuteMemberRequest(roomId: string, muteId: string, reason: string) {
  return { url: `/api/v1/rooms/${encodeURIComponent(roomId)}/mutes/${encodeURIComponent(muteId)}`, init: json({ reason }, "DELETE") };
}

export function reportChatMessageRequest(roomId: string, messageId: string, reason: string) {
  return { url: `/api/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/reports`, init: json({ reason }, "POST") };
}

/**
 * Presentation copy of the server's closed mute-duration list. The server
 * validates against the domain's MUTE_DURATION_HOURS — an option added here
 * without the server knowing it is refused with a 422, never silently applied.
 */
export const MUTE_DURATION_OPTIONS = [
  { hours: 1, labelKey: "room.chat.hours1" },
  { hours: 24, labelKey: "room.chat.hours24" },
  { hours: 72, labelKey: "room.chat.hours72" },
  { hours: 168, labelKey: "room.chat.hours168" },
] as const;

/** Queue an optimistic message; it renders immediately with a sending badge. */
export function appendPending(pending: PendingMessage[], localId: string, body: string, nowIso: string): PendingMessage[] {
  return [...pending, { localId, body, createdAt: nowIso, status: "sending" }];
}

/** The server confirmed (or the author discarded) this pending message. */
export function removePending(pending: PendingMessage[], localId: string): PendingMessage[] {
  return pending.filter((entry) => entry.localId !== localId);
}

/** The send failed: keep the text so the author can retry, never silently drop it. */
export function failPending(pending: PendingMessage[], localId: string, error: string): PendingMessage[] {
  return pending.map((entry) => (entry.localId === localId ? { ...entry, status: "failed" as const, error } : entry));
}

/** Retry resets a failed entry to sending; the caller re-issues the request. */
export function retryPending(pending: PendingMessage[], localId: string): PendingMessage[] {
  return pending.map((entry) => (entry.localId === localId ? { ...entry, status: "sending" as const, error: undefined } : entry));
}

/**
 * Insert a just-confirmed message at the newest end without duplicating it —
 * the next poll may already contain it.
 */
export function mergeConfirmed(messages: ChatMessageRecord[], confirmed: ChatMessageRecord): ChatMessageRecord[] {
  if (messages.some((message) => message.id === confirmed.id)) return messages;
  return [confirmed, ...messages];
}

/**
 * Business rejections arrive as stable error codes; the UI renders them
 * through i18n, never the server's English `message` string. Room chat and
 * the club channel share one vocabulary (`chat.err.*`).
 */
export function chatErrorKey(code: string | undefined): MessageKey {
  switch (code) {
    case "MUTED": return "chat.err.MUTED";
    case "COMMUNITY_MUTED": return "chat.err.COMMUNITY_MUTED";
    case "RULES_CONFIRMATION_REQUIRED": return "chat.err.RULES_CONFIRMATION_REQUIRED";
    case "RATE_LIMITED": return "chat.err.RATE_LIMITED";
    case "DUPLICATE_MESSAGE": return "chat.err.DUPLICATE_MESSAGE";
    case "MESSAGE_INVALID": return "chat.err.MESSAGE_INVALID";
    case "ROOM_NOT_ACTIVE": return "chat.err.ROOM_NOT_ACTIVE";
    case "ROOM_NOT_FOUND": return "chat.err.ROOM_NOT_FOUND";
    case "MESSAGE_NOT_FOUND": return "chat.err.MESSAGE_NOT_FOUND";
    case "MESSAGE_NOT_PINNED": return "chat.err.MESSAGE_NOT_PINNED";
    case "MEMBER_NOT_FOUND": return "chat.err.MEMBER_NOT_FOUND";
    case "SELF_MUTE_FORBIDDEN": return "chat.err.SELF_MUTE_FORBIDDEN";
    case "SELF_REPORT_FORBIDDEN": return "chat.err.SELF_REPORT_FORBIDDEN";
    case "MUTE_ALREADY_ACTIVE": return "chat.err.MUTE_ALREADY_ACTIVE";
    case "MUTE_NOT_ACTIVE": return "chat.err.MUTE_NOT_ACTIVE";
    case "REPORT_ALREADY_OPEN": return "chat.err.REPORT_ALREADY_OPEN";
    case "INVALID_REQUEST": return "chat.err.INVALID_REQUEST";
    case "UNAUTHENTICATED": return "chat.err.UNAUTHENTICATED";
    case "INVALID_ORIGIN": return "chat.err.INVALID_ORIGIN";
    default: return "room.chat.errorGeneric";
  }
}

type KeyedMessage = { id: string; createdAt: string };

/**
 * Reconcile a freshly polled page with what is already on screen. A poll that
 * was issued BEFORE a send committed can resolve AFTER the send's
 * mergeConfirmed — replacing state with that stale snapshot makes the user's
 * just-confirmed message vanish for a full poll cycle (and invites a resend
 * that hits DUPLICATE_MESSAGE). Keep any current message that is strictly
 * newer than the snapshot's newest row; everything else follows the snapshot,
 * so moderation removals still land.
 */
export function reconcileMessages<T extends KeyedMessage>(current: T[], incoming: T[]): T[] {
  const newest = incoming[0];
  const keep = current.filter(
    (message) =>
      !incoming.some((entry) => entry.id === message.id) &&
      (!newest ||
        message.createdAt > newest.createdAt ||
        (message.createdAt === newest.createdAt && message.id > newest.id)),
  );
  return keep.length === 0 ? incoming : [...keep, ...incoming];
}

/**
 * Drop optimistic entries the poll has already confirmed: when a poll lands
 * while the POST is still in flight, the same text would otherwise render
 * twice (confirmed row + "sending…" row). Failed entries stay — they hold the
 * retry/discard controls.
 *
 * Matching requires the author, not just the body: another member posting the
 * identical text while ours is in flight must not retire our "sending…" row —
 * our own POST may still fail, and the message would be lost without a retry
 * state. While the viewer's PULSE ID is still unknown (nothing sent yet this
 * mount), nothing is dropped; the POST resolution cleans up via removePending.
 */
export function dropDeliveredPending(
  pending: PendingMessage[],
  messages: Array<{ body: string; authorPulseId: string }>,
  viewerPulseId: string | null,
): PendingMessage[] {
  if (!viewerPulseId) return pending;
  return pending.filter(
    (entry) =>
      !(entry.status === "sending" &&
        messages.some((message) => message.authorPulseId === viewerPulseId && message.body === entry.body)),
  );
}

/** True while the caller's mute window is still running. */
export function isMutedNow(mutedUntil: string | null, now: Date): boolean {
  if (!mutedUntil) return false;
  const until = new Date(mutedUntil);
  return Number.isFinite(until.getTime()) && until.getTime() > now.getTime();
}
