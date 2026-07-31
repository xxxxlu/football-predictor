/**
 * Engagement badges (Story 12.2). A closed enum mirrored by a database CHECK;
 * badges are non-transferable, non-redeemable, and grant nothing anywhere else.
 */

import type { LocalizedText } from "./challenge.js";

export const BADGE_KEYS = ["FIRST_ANSWER", "STREAK_7", "STREAK_30"] as const;
export type BadgeKey = (typeof BADGE_KEYS)[number];

export const BADGE_LABELS: Record<BadgeKey, LocalizedText> = {
  FIRST_ANSWER: { zh: "首次作答", en: "First answer" },
  STREAK_7: { zh: "7 连胜", en: "7-day streak" },
  STREAK_30: { zh: "30 连胜", en: "30-day streak" },
};

/**
 * Which badges this attempt earns. Idempotent by design: the caller inserts
 * with ON CONFLICT DO NOTHING against the (user, badge) unique constraint, so
 * re-deciding an already-held badge is harmless.
 */
export function badgesEarned(input: { isFirstAnswer: boolean; streakAfter: number }): BadgeKey[] {
  const earned: BadgeKey[] = [];
  if (input.isFirstAnswer) earned.push("FIRST_ANSWER");
  if (input.streakAfter >= 7) earned.push("STREAK_7");
  if (input.streakAfter >= 30) earned.push("STREAK_30");
  return earned;
}
