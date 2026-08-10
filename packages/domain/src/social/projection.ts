/**
 * Minimal-disclosure guard for every friend-facing projection (Story 12.1 AC4).
 *
 * Same philosophy as `assertMinimalReportContext` in governance: an exact key
 * allowlist per projection, checked at the read boundary, so a future join that
 * drags rooms, predictions, ledgers or balances into a friend payload fails loud
 * in every environment instead of quietly shipping private data (FR84/NFR19).
 */

const FORBIDDEN_KEY_PATTERN =
  /(room|ticket|ledger|balance|point|stake|odds|prediction|wallet|settle|invite|session|password|recovery|token)/i;

/**
 * Story 12.6 widens each allowlist by exactly two keys — `avatarUrl` and
 * `avatarVersion` — and nothing else. The URL is a same-origin media path derived
 * from the avatar row's random public id, so an avatar adds no identifier a
 * friend payload did not already carry.
 *
 * The block list carries the pair for response-shape stability only: `listBlocks`
 * always emits nulls there, because a block must stop serving either side the
 * other's photo (the AC2 symmetry rule). The UI renders its low-emphasis initials
 * fallback from the nickname it already shows.
 */
export const FRIEND_LIST_PROJECTION_KEYS = ["userId", "pulseId", "nickname", "online", "avatarUrl", "avatarVersion"] as const;
export const FRIEND_REQUEST_PROJECTION_KEYS = ["requestId", "direction", "userId", "pulseId", "nickname", "createdAt", "avatarUrl", "avatarVersion"] as const;
export const BLOCK_PROJECTION_KEYS = ["userId", "pulseId", "nickname", "createdAt", "avatarUrl", "avatarVersion"] as const;
export const PRESENCE_PREFERENCES_PROJECTION_KEYS = ["showOnlineToFriends", "showLobbyToFriends", "showInLobbyDirectory"] as const;

/**
 * Walks a projection (object or array of objects) and throws when any key is
 * outside the allowlist or matches a category that must never travel with a
 * friend payload. Values are scanned recursively as a second line of defence.
 */
export function assertMinimalFriendProjection(value: unknown, allowedKeys: readonly string[]): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const entry of value) assertMinimalFriendProjection(entry, allowedKeys);
    return;
  }
  if (value instanceof Date || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      throw new Error(`friend projection must never carry "${key}"`);
    }
    if (!allowedKeys.includes(key)) {
      throw new Error(`unexpected key "${key}" in friend projection`);
    }
    assertMinimalFriendProjection(nested, allowedKeys);
  }
}
