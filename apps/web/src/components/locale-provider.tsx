"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { LOCALE_COOKIE, type Locale, translate } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/i18n/messages";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
  const [locale, setLocaleState] = useState(initialLocale);

  const setLocale = (nextLocale: Locale) => {
    if (nextLocale === locale) return;
    setLocaleState(nextLocale);
  };

  useEffect(() => {
    document.documentElement.lang = locale;
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t: (key: MessageKey) => translate(locale, key) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used within LocaleProvider");
  return context;
}
