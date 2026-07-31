import { describe, expect, it } from "vitest";

import { FORTUNE_DECK, fortuneFor, fortuneShareText } from "./fortune.js";

describe("fortune deck", () => {
  it("ships a bilingual deck with unique keys", () => {
    expect(FORTUNE_DECK.length).toBeGreaterThanOrEqual(10);
    expect(new Set(FORTUNE_DECK.map((card) => card.key)).size).toBe(FORTUNE_DECK.length);
    for (const card of FORTUNE_DECK) {
      expect(card.title.zh.length).toBeGreaterThan(0);
      expect(card.title.en.length).toBeGreaterThan(0);
      expect(card.text.zh.length).toBeGreaterThan(0);
      expect(card.text.en.length).toBeGreaterThan(0);
    }
  });

  it("never suggests betting, odds, fixtures or outcomes (FR87 content red line)", () => {
    const copy = JSON.stringify(FORTUNE_DECK).toLowerCase();
    for (const banned of ["投注", "下注", "赔率", "买", "胜负", "比分", "串关"]) {
      expect(copy).not.toContain(banned);
    }
    // English terms need word boundaries: "bet" must not misfire on "better".
    for (const banned of [/\bbets?\b/, /\bbetting\b/, /\bodds\b/, /\bstakes?\b/, /\bwagers?\b/, /\bparlays?\b/, /\bwin today\b/]) {
      expect(copy).not.toMatch(banned);
    }
  });
});

describe("fortuneFor", () => {
  it("is deterministic: same user and day always draw the same card", () => {
    expect(fortuneFor("user-1", "2026-07-31")).toBe(fortuneFor("user-1", "2026-07-31"));
  });

  it("varies across users and across days", () => {
    // Not guaranteed distinct for every pair, but across a sample the draws must differ.
    const users = Array.from({ length: 30 }, (_, index) => `user-${index}`);
    const cards = new Set(users.map((user) => fortuneFor(user, "2026-07-31").key));
    expect(cards.size).toBeGreaterThan(1);
    const days = Array.from({ length: 30 }, (_, index) => new Date(Date.UTC(2026, 7, 1 + index)).toISOString().slice(0, 10));
    const daily = new Set(days.map((day) => fortuneFor("user-1", day).key));
    expect(daily.size).toBeGreaterThan(1);
  });
});

describe("fortuneShareText", () => {
  it("contains only the card copy in the requested language", () => {
    const card = FORTUNE_DECK[0]!;
    expect(fortuneShareText(card, "zh")).toContain(card.title.zh);
    expect(fortuneShareText(card, "zh")).toContain(card.text.zh);
    expect(fortuneShareText(card, "en")).toContain(card.title.en);
  });
});
