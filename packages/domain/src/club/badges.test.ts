import { describe, expect, it } from "vitest";

import { BADGE_KEYS, BADGE_LABELS, badgesEarned } from "./badges.js";

describe("badges", () => {
  it("is a closed three-badge enum with bilingual labels", () => {
    expect(BADGE_KEYS).toEqual(["FIRST_ANSWER", "STREAK_7", "STREAK_30"]);
    for (const key of BADGE_KEYS) {
      expect(BADGE_LABELS[key].zh.length).toBeGreaterThan(0);
      expect(BADGE_LABELS[key].en.length).toBeGreaterThan(0);
    }
  });

  it("decides awards from first-answer and streak thresholds", () => {
    expect(badgesEarned({ isFirstAnswer: true, streakAfter: 1 })).toEqual(["FIRST_ANSWER"]);
    expect(badgesEarned({ isFirstAnswer: false, streakAfter: 6 })).toEqual([]);
    expect(badgesEarned({ isFirstAnswer: false, streakAfter: 7 })).toEqual(["STREAK_7"]);
    expect(badgesEarned({ isFirstAnswer: false, streakAfter: 30 })).toEqual(["STREAK_7", "STREAK_30"]);
    expect(badgesEarned({ isFirstAnswer: true, streakAfter: 30 })).toEqual(["FIRST_ANSWER", "STREAK_7", "STREAK_30"]);
  });
});
