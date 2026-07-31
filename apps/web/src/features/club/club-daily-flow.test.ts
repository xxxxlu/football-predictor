import { describe, expect, it } from "vitest";

import {
  attemptFeedback,
  badgeLabel,
  buildFortuneShareText,
  clubErrorKey,
  localizeText,
  type DailyAttemptPayload,
} from "./club-daily-flow.js";

const attempt = (isCorrect: boolean): DailyAttemptPayload => ({
  productDay: "2026-07-31", questionKey: "q", answer: "A", isCorrect, xpAwarded: isCorrect ? 11 : 0, streakAfter: isCorrect ? 1 : 0,
});

describe("attemptFeedback", () => {
  it("always pairs a text verdict with a non-color symbol (NFR24 dual channel)", () => {
    const right = attemptFeedback(attempt(true));
    expect(right).toEqual({ messageKey: "club.daily.correct", symbol: "✓", tone: "success" });
    const wrong = attemptFeedback(attempt(false));
    expect(wrong).toEqual({ messageKey: "club.daily.wrong", symbol: "✗", tone: "error" });
    expect(right.symbol).not.toBe(wrong.symbol);
  });
});

describe("localizeText", () => {
  it("selects by locale with zh as the base language", () => {
    const text = { zh: "中文", en: "English" };
    expect(localizeText(text, "zh-CN")).toBe("中文");
    expect(localizeText(text, "en")).toBe("English");
  });
});

describe("clubErrorKey", () => {
  it("maps every API code the feature can produce, with a generic fallback", () => {
    expect(clubErrorKey("UNAUTHENTICATED")).toBe("club.daily.errorUnauthenticated");
    expect(clubErrorKey("INVALID_REQUEST")).toBe("club.daily.errorInvalid");
    expect(clubErrorKey("ROOM_NOT_FOUND")).toBe("club.daily.errorRoomNotFound");
    expect(clubErrorKey("SOMETHING")).toBe("club.daily.errorGeneric");
    expect(clubErrorKey(undefined)).toBe("club.daily.errorGeneric");
  });
});

describe("buildFortuneShareText", () => {
  it("contains the card copy alone in the requested language", () => {
    const card = { key: "k", title: { zh: "铁血中场", en: "Iron Midfielder" }, text: { zh: "文案", en: "Copy" } };
    const zh = buildFortuneShareText(card, "zh-CN");
    expect(zh).toContain("铁血中场");
    expect(zh).toContain("文案");
    expect(zh).not.toContain("http");
    expect(buildFortuneShareText(card, "en")).toContain("Iron Midfielder");
  });

  it("stays byte-identical to the domain template it deliberately duplicates", async () => {
    // The client copy exists so the bundle never imports @pulse/domain
    // (node:crypto); this pin is the only thing keeping the two from drifting.
    const { fortuneShareText } = await import("@pulse/domain");
    const card = { key: "k", title: { zh: "铁血中场", en: "Iron Midfielder" }, text: { zh: "文案", en: "Copy" } };
    expect(buildFortuneShareText(card, "zh-CN")).toBe(fortuneShareText(card, "zh"));
    expect(buildFortuneShareText(card, "en")).toBe(fortuneShareText(card, "en"));
  });
});

describe("badgeLabel", () => {
  it("labels the closed badge set bilingually and passes unknown keys through", () => {
    expect(badgeLabel("FIRST_ANSWER", "zh-CN")).toBe("首次作答");
    expect(badgeLabel("STREAK_7", "en")).toBe("7-day streak");
    expect(badgeLabel("FUTURE_BADGE", "en")).toBe("FUTURE_BADGE");
  });
});
