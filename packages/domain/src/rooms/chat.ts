/**
 * Room public chat rules (Story 12.3, FR88).
 *
 * Plain text only, immutable messages: no edit, no delete — visibility changes
 * go through room.message_moderation (the 11.3 principle). Membership decides
 * everything a reader may see; a non-member's read or write is answered exactly
 * like a missing room. Nothing here touches a supplier, a balance, a prediction
 * or a ledger row (AC4).
 */

import { governanceReasonLength } from "../identity/service.js";

/** Body bounds in CODE POINTS — the same unit as the PG char_length CHECK. */
export const MESSAGE_MIN_LENGTH = 1;
export const MESSAGE_MAX_LENGTH = 500;

/** Persisted rate window: same member, same room (pending PM decision #3). */
export const MESSAGES_PER_WINDOW = 10;
export const MESSAGE_WINDOW_SECONDS = 60;

/** Default page size for keyset pagination; bounded to keep payloads sane. */
export const MESSAGE_PAGE_SIZE = 50;

export function messageBodyLength(body: string): number {
  return governanceReasonLength(body);
}

/** Trims and bounds a candidate body; null means "refuse with 422". */
export function normalizeMessageBody(raw: string): string | null {
  const trimmed = raw.trim();
  const length = messageBodyLength(trimmed);
  return length >= MESSAGE_MIN_LENGTH && length <= MESSAGE_MAX_LENGTH ? trimmed : null;
}

/** Consecutive-duplicate guard: the exact same body as the member's last message. */
export function isDuplicateMessage(previousBody: string | null, nextBody: string): boolean {
  return previousBody !== null && previousBody === nextBody;
}

/** What a member may read about a message — nothing else leaves the data layer. */
export interface ChatMessageProjection {
  id: string;
  authorPulseId: string;
  authorNickname: string | null;
  body: string;
  createdAt: Date;
  isPinned: boolean;
}

export const CHAT_MESSAGE_PROJECTION_KEYS = [
  "id",
  "authorPulseId",
  "authorNickname",
  "body",
  "createdAt",
  "isPinned",
] as const;

const FORBIDDEN_KEY_PATTERN =
  /(ticket|ledger|balance|point|stake|odds|prediction|wallet|settle|invite|session|password|recovery|token|report)/i;

/**
 * Same guard family as social/club projections: exact allowlist plus forbidden
 * categories, applied at the read boundary so a widened join fails loudly
 * instead of shipping stakes or ledger figures through the chat payload.
 */
export function assertMinimalChatProjection(value: unknown, allowedKeys: readonly string[] = CHAT_MESSAGE_PROJECTION_KEYS): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const entry of value) assertMinimalChatProjection(entry, allowedKeys);
    return;
  }
  if (value instanceof Date || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) throw new Error(`chat projection must never carry "${key}"`);
    if (!allowedKeys.includes(key)) throw new Error(`unexpected key "${key}" in chat projection`);
    assertMinimalChatProjection(nested, allowedKeys);
  }
}

/**
 * Keyset cursor over (created_at DESC, id DESC) — the first real cursor in the
 * codebase (architecture L147 `{data, meta:{cursor}}`). Encoded as base64url
 * JSON; a cursor that fails to decode is refused, never silently ignored, so a
 * malformed value cannot hand back page one as if it were the next page.
 */
export interface ChatCursor {
  createdAt: string;
  id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeChatCursor(cursor: ChatCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeChatCursor(raw: string): ChatCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<ChatCursor>;
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") return null;
    if (!UUID_PATTERN.test(parsed.id)) return null;
    const instant = new Date(parsed.createdAt);
    if (Number.isNaN(instant.getTime())) return null;
    // Bind the normalized ISO string, never the raw value: JS accepts date
    // grammars Postgres does not (e.g. "0"), and a raw pass-through turns a
    // tampered cursor into a timestamptz cast error (500) instead of this
    // decoder's refusal (422).
    return { createdAt: instant.toISOString(), id: parsed.id.toLowerCase() };
  } catch {
    return null;
  }
}
