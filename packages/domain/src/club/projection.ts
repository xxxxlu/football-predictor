/**
 * Minimal-disclosure guard for club result projections (Story 12.2, AC2/AC4).
 * Same pattern as social/projection.ts: exact allowlist at the read boundary,
 * plus a forbidden-category regex so a widened allowlist still cannot smuggle
 * anything from the points/ledger/prediction domains into a club payload.
 */

// "answered" is a legitimate projection key, so the answer secrecy rule is
// spelled as correctOption/answerKey rather than a bare "answer" substring.
const FORBIDDEN_KEY_PATTERN =
  /(room|ticket|ledger|balance|point|stake|odds|prediction|wallet|settle|invite|session|password|recovery|token|correctOption|answerKey)/i;

/** Friend/room member result rows: identity + participation only. */
export const CLUB_RESULT_PROJECTION_KEYS = ["pulseId", "nickname", "answered", "correct", "streak"] as const;

export function assertMinimalClubProjection(value: unknown, allowedKeys: readonly string[]): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const entry of value) assertMinimalClubProjection(entry, allowedKeys);
    return;
  }
  if (value instanceof Date || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      throw new Error(`club projection must never carry "${key}"`);
    }
    if (!allowedKeys.includes(key)) {
      throw new Error(`unexpected key "${key}" in club projection`);
    }
    assertMinimalClubProjection(nested, allowedKeys);
  }
}
