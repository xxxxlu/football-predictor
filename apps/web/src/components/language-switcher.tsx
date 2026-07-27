"use client";

import { useLocale } from "./locale-provider";
import type { Locale } from "@/lib/i18n/messages";

const options: { locale: Locale; key: "language.zh" | "language.en" }[] = [
  { locale: "zh-CN", key: "language.zh" },
  { locale: "en", key: "language.en" },
];

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <div aria-label={t("language.switcher")} className={`inline-flex items-center rounded-full border border-white/25 p-0.5 text-[11px] font-bold tracking-[0.08em] ${compact ? "" : "bg-white/5"}`}>
      {options.map((option) => {
        const active = locale === option.locale;
        return <button
          key={option.locale}
          type="button"
          aria-pressed={active}
          aria-label={`${t("language.current")}: ${t(option.key)}`}
          disabled={active}
          onClick={() => setLocale(option.locale)}
          className={`min-h-8 rounded-full px-2.5 transition-colors ${active ? "bg-white text-black" : "text-white/70 hover:bg-white/10 hover:text-white"} disabled:cursor-default`}
        >{option.locale === "zh-CN" ? "中" : "EN"}</button>;
      })}
    </div>
  );
}
