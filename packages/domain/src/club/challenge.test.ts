import { describe, expect, it } from "vitest";

import {
  CHALLENGE_BANK,
  CHALLENGE_OPTION_KEYS,
  isCorrectAnswer,
  nextStreak,
  questionByKey,
  questionForProductDay,
  toPublicQuestion,
  XP_PER_CORRECT_ANSWER,
  XP_STREAK_BONUS_CAP,
  xpForAnswer,
} from "./challenge.js";

describe("challenge bank", () => {
  it("ships at least 30 questions with unique keys and bilingual copy", () => {
    expect(CHALLENGE_BANK.length).toBeGreaterThanOrEqual(30);
    expect(new Set(CHALLENGE_BANK.map((question) => question.key)).size).toBe(CHALLENGE_BANK.length);
    for (const question of CHALLENGE_BANK) {
      expect(question.prompt.zh.length).toBeGreaterThan(0);
      expect(question.prompt.en.length).toBeGreaterThan(0);
      expect(question.options.length).toBe(4);
      expect(question.options.map((option) => option.key)).toEqual([...CHALLENGE_OPTION_KEYS]);
      expect(question.options.some((option) => option.key === question.correctOption)).toBe(true);
      for (const option of question.options) {
        expect(option.text.zh.length).toBeGreaterThan(0);
        expect(option.text.en.length).toBeGreaterThan(0);
      }
    }
  });

  it("never mentions betting, odds or staking in any question copy (content red line)", () => {
    const copy = JSON.stringify(CHALLENGE_BANK);
    for (const banned of ["投注", "下注", "赔率", "串关", "bet", "odds", "stake", "wager"]) {
      expect(copy.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
});

describe("questionForProductDay", () => {
  it("is deterministic and rotates daily through the bank", () => {
    expect(questionForProductDay("2026-07-31")).toBe(questionForProductDay("2026-07-31"));
    const today = questionForProductDay("2026-07-31");
    const tomorrow = questionForProductDay("2026-08-01");
    expect(tomorrow.key).not.toBe(today.key);
  });

  it("covers the whole bank over one full cycle without repeats", () => {
    const keys = new Set<string>();
    for (let offset = 0; offset < CHALLENGE_BANK.length; offset++) {
      const day = new Date(Date.UTC(2026, 7, 1 + offset)).toISOString().slice(0, 10);
      keys.add(questionForProductDay(day).key);
    }
    expect(keys.size).toBe(CHALLENGE_BANK.length);
  });
});

describe("public projection of a question", () => {
  it("has no correctOption property at all — not a blanked one", () => {
    const question = questionForProductDay("2026-07-31");
    const publicQuestion = toPublicQuestion(question);
    expect("correctOption" in publicQuestion).toBe(false);
    expect(JSON.stringify(publicQuestion)).not.toContain("correctOption");
  });
});

describe("scoring", () => {
  it("accepts only the exact correct option", () => {
    const question = CHALLENGE_BANK[0]!;
    expect(isCorrectAnswer(question, question.correctOption)).toBe(true);
    const wrong = CHALLENGE_OPTION_KEYS.find((key) => key !== question.correctOption)!;
    expect(isCorrectAnswer(question, wrong)).toBe(false);
  });

  it("looks questions up by key for replay scoring", () => {
    expect(questionByKey(CHALLENGE_BANK[3]!.key)).toBe(CHALLENGE_BANK[3]);
    expect(questionByKey("no-such-question")).toBeNull();
  });
});

describe("streak rules", () => {
  it("continues only from exactly the previous product day", () => {
    expect(nextStreak({ lastAnsweredDay: "2026-07-30", currentStreak: 3, day: "2026-07-31", correct: true })).toBe(4);
    // A skipped day restarts at 1 even after a long run (隔产品日断连).
    expect(nextStreak({ lastAnsweredDay: "2026-07-29", currentStreak: 9, day: "2026-07-31", correct: true })).toBe(1);
    expect(nextStreak({ lastAnsweredDay: null, currentStreak: 0, day: "2026-07-31", correct: true })).toBe(1);
  });

  it("resets to zero on a wrong answer regardless of history", () => {
    expect(nextStreak({ lastAnsweredDay: "2026-07-30", currentStreak: 29, day: "2026-07-31", correct: false })).toBe(0);
  });
});

describe("xp rules", () => {
  it("awards 10 + capped streak bonus for correct, zero for wrong", () => {
    expect(xpForAnswer(true, 1)).toBe(XP_PER_CORRECT_ANSWER + 1);
    expect(xpForAnswer(true, 7)).toBe(XP_PER_CORRECT_ANSWER + XP_STREAK_BONUS_CAP);
    expect(xpForAnswer(true, 30)).toBe(XP_PER_CORRECT_ANSWER + XP_STREAK_BONUS_CAP);
    expect(xpForAnswer(false, 0)).toBe(0);
  });
});
