/**
 * Room public chat client flow (Story 12.3, FR88). Pure module: request
 * builders, code-point validation and the optimistic-send bookkeeping live
 * here so they are testable without React.
 *
 * Types mirror the server projection structurally — this module must stay
 * importable from client components, so it never imports @pulse/domain
 * (the 12.2 precedent: the domain barrel pulls node-only modules).
 */

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

/** True while the caller's mute window is still running. */
export function isMutedNow(mutedUntil: string | null, now: Date): boolean {
  if (!mutedUntil) return false;
  const until = new Date(mutedUntil);
  return Number.isFinite(until.getTime()) && until.getTime() > now.getTime();
}
