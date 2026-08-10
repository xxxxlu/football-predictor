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
import { decodeKeysetCursor, encodeKeysetCursor, type KeysetCursor } from "./keyset-cursor.js";

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
  // Postgres text columns reject NUL outright — refuse it here as the 422 it
  // is, instead of letting the insert surface a 500.
  if (trimmed.includes("\u0000")) return null;
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
  authorAvatarUrl: string | null;
  authorAvatarVersion: number | null;
  body: string;
  createdAt: Date;
  isPinned: boolean;
}

export const CHAT_MESSAGE_PROJECTION_KEYS = [
  "id",
  "authorPulseId",
  "authorNickname",
  "authorAvatarUrl",
  "authorAvatarVersion",
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
 * Chat's keyset cursor over (created_at DESC, id DESC). The encoding lives in
 * `keyset-cursor.ts` because the public-room lobby pages the same way; these
 * names stay so chat's callers keep reading in chat's vocabulary.
 */
export type ChatCursor = KeysetCursor;
export const encodeChatCursor = encodeKeysetCursor;
export const decodeChatCursor = decodeKeysetCursor;
