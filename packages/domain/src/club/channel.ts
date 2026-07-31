/**
 * PULSE CLUB public channel and lobby rules (Story 12.4, FR89).
 *
 * One site-wide plain-text channel inside the club subdomain. The lobby is not
 * a points room: nothing here may name a room, a ticket, a ledger figure or a
 * prediction — the projection guard below enforces that at every read boundary,
 * and the club schema holds no foreign key into those domains.
 *
 * Messages are immutable, like room chat (12.3): visibility changes go through
 * club.channel_message_moderation, and a community mute is trusted only while
 * `muted_until > now()` — never on `lifted_at` alone.
 */

import { isDuplicateMessage, messageBodyLength, normalizeMessageBody } from "../rooms/chat.js";

export { isDuplicateMessage, messageBodyLength, normalizeMessageBody };

/**
 * The community rules a member must confirm before writing to the channel.
 * A domain constant, not the registration RULES_VERSION env: the namespace
 * keys a separate row in identity.rule_acceptances (PK user_id+rules_version),
 * so confirming the community rules never touches registration semantics.
 */
export const COMMUNITY_RULES_VERSION = "community:v1" as const;

/** Body bounds are the room-chat bounds (1–500 code points); the constants are re-exported via rooms/chat. */

/** Tighter than a room: one shared channel for the whole site. */
export const CHANNEL_MESSAGES_PER_WINDOW = 5;
export const CHANNEL_WINDOW_SECONDS = 60;

/** Keyset page size, and the product default for how far the channel scrolls back. */
export const CHANNEL_PAGE_SIZE = 50;
export const CHANNEL_READ_WINDOW_MESSAGES = 200;

/**
 * What the inbox shows as the "place" of a channel report. A channel report has
 * no room, so the subject scope is this fixed label — never a NULL room name.
 */
export const CHANNEL_REPORT_SCOPE = "PULSE CLUB" as const;

/**
 * Stable refusal codes for the channel write path (AC2). Every one names its
 * own recovery: confirm the rules, wait out the mute, slow down, say something
 * new. The HTTP status is what OperationError carries in the repository.
 */
export const CHANNEL_WRITE_REFUSALS = {
  RULES_CONFIRMATION_REQUIRED: 403,
  COMMUNITY_MUTED: 403,
  RATE_LIMITED: 429,
  DUPLICATE_MESSAGE: 422,
} as const;
export type ChannelWriteRefusal = keyof typeof CHANNEL_WRITE_REFUSALS;

/** A channel message as a reader may see it. No pin slot — the channel has none. */
export interface ChannelMessageProjection {
  id: string;
  authorPulseId: string;
  authorNickname: string | null;
  body: string;
  createdAt: Date;
}

export const CHANNEL_MESSAGE_PROJECTION_KEYS = [
  "id",
  "authorPulseId",
  "authorNickname",
  "body",
  "createdAt",
] as const;

/** The lobby directory: opted-in, present, and nothing but the public pair. */
export const LOBBY_DIRECTORY_PROJECTION_KEYS = ["pulseId", "nickname"] as const;

/**
 * Friend activity is a composed read model (12.1 presence × 12.2 challenge
 * completion), not an event stream. `answeredToday` is null when the viewer has
 * not answered today's challenge themselves — the 12.2 mutual-submission gate.
 * `inLobby` is the reader for the 12.1 `show_lobby_to_friends` toggle: friends
 * only, gated on that consent column and the presence TTL.
 */
export const FRIEND_ACTIVITY_PROJECTION_KEYS = ["pulseId", "nickname", "online", "inLobby", "answeredToday"] as const;

/**
 * Forbidden categories for anything the lobby ships. `room` is on the list —
 * the public-room discovery block goes through the rooms API and its own
 * guards, never through a lobby projection.
 */
const FORBIDDEN_KEY_PATTERN =
  /(room|ticket|ledger|balance|point|stake|odds|prediction|wallet|settle|invite|session|password|recovery|token|report)/i;

/** Same guard family as 12.1/12.2/12.3: exact allowlist plus forbidden categories, recursive. */
export function assertMinimalLobbyProjection(value: unknown, allowedKeys: readonly string[]): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const entry of value) assertMinimalLobbyProjection(entry, allowedKeys);
    return;
  }
  if (value instanceof Date || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) throw new Error(`lobby projection must never carry "${key}"`);
    if (!allowedKeys.includes(key)) throw new Error(`unexpected key "${key}" in lobby projection`);
    assertMinimalLobbyProjection(nested, allowedKeys);
  }
}
