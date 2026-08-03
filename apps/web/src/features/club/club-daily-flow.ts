/**
 * Pure view logic for the daily challenge (Story 12.2). All copy resolves to
 * MessageKeys so zh/en stay typecheck-paired in lib/i18n/messages.ts; the .tsx
 * view stays a thin renderer (vitest does not pick up .test.tsx).
 *
 * NOTE: this module must stay importable from the client bundle, so it never
 * imports @pulse/domain (fortune.ts pulls in node:crypto). The API payload
 * types are re-declared structurally here.
 */

import type { MessageKey } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/messages";

export interface LocalizedTextPayload {
  zh: string;
  en: string;
}

export interface DailyQuestionPayload {
  key: string;
  prompt: LocalizedTextPayload;
  options: Array<{ key: "A" | "B" | "C" | "D"; text: LocalizedTextPayload }>;
}

export interface DailyAttemptPayload {
  productDay: string;
  questionKey: string;
  answer: "A" | "B" | "C" | "D";
  isCorrect: boolean;
  xpAwarded: number;
  streakAfter: number;
}

export interface EngagementPayload {
  xpTotal: number;
  currentStreak: number;
  bestStreak: number;
  lastAnsweredDay: string | null;
}

export interface FortunePayload {
  key: string;
  title: LocalizedTextPayload;
  text: LocalizedTextPayload;
}

export interface DailyPayload {
  day: string;
  question: DailyQuestionPayload;
  fortune: FortunePayload;
  attempt: DailyAttemptPayload | null;
  profile: EngagementPayload;
  badges: string[];
}

export interface DailyResultRowPayload {
  pulseId: string;
  nickname: string | null;
  answered: boolean;
  correct: boolean | null;
  streak: number;
}

export interface DailyResultsPayload {
  locked: boolean;
  friends: DailyResultRowPayload[];
  room: DailyResultRowPayload[] | null;
}

export function localizeText(text: LocalizedTextPayload, locale: Locale): string {
  return locale === "en" ? text.en : text.zh;
}

/**
 * Answer feedback is a dual channel by design (NFR24): a text verdict plus a
 * non-color symbol, so the outcome never rides on red/green alone.
 */
export function attemptFeedback(attempt: DailyAttemptPayload): { messageKey: MessageKey; symbol: string; tone: "success" | "error" } {
  return attempt.isCorrect
    ? { messageKey: "club.daily.correct", symbol: "✓", tone: "success" }
    : { messageKey: "club.daily.wrong", symbol: "✗", tone: "error" };
}

export function clubErrorKey(code: string | undefined): MessageKey {
  switch (code) {
    case "UNAUTHENTICATED": return "club.daily.errorUnauthenticated";
    case "INVALID_REQUEST": return "club.daily.errorInvalid";
    case "ROOM_NOT_FOUND": return "club.daily.errorRoomNotFound";
    case "DAY_ROLLED_OVER": return "club.daily.errorDayRolled";
    default: return "club.daily.errorGeneric";
  }
}

/** Share text is the card copy alone — no link, no fixture, no hint of stakes. */
export function buildFortuneShareText(card: FortunePayload, locale: Locale): string {
  return locale === "en"
    ? `My PULSE fortune today: "${card.title.en}" — ${card.text.en}`
    : `我今天的 PULSE 运势：「${card.title.zh}」——${card.text.zh}`;
}

export const BADGE_LABEL_KEYS: Record<string, LocalizedTextPayload> = {
  FIRST_ANSWER: { zh: "首次作答", en: "First answer" },
  STREAK_7: { zh: "7 连胜", en: "7-day streak" },
  STREAK_30: { zh: "30 连胜", en: "30-day streak" },
};

export function badgeLabel(key: string, locale: Locale): string {
  const label = BADGE_LABEL_KEYS[key];
  return label ? localizeText(label, locale) : key;
}
