import { messages, SUPPORTED_LOCALES, type Locale, type MessageKey } from "./messages";

export type { Locale } from "./messages";

export const LOCALE_COOKIE = "pulse_locale";
export const DEFAULT_LOCALE: Locale = "zh-CN";

export function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function translate(locale: Locale, key: MessageKey): string {
  return messages[locale][key];
}
