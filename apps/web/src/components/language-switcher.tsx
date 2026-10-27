"use client";

import { useLocale } from "./locale-provider";
import type { Locale, MessageKey } from "@/lib/i18n/messages";

const options: { locale: Locale; label: string; key: MessageKey }[] = [
  { locale: "zh-CN", label: "中", key: "language.zh" },
  { locale: "en", label: "EN", key: "language.en" },
  { locale: "de", label: "DE", key: "language.de" },
  { locale: "es", label: "ES", key: "language.es" },
];

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLocale();
  return (
    // 配色交给 .pd-lang：它默认按浅色表面算，落进 .night 会整组翻成白色系。
    <div aria-label={t("language.switcher")} className={`pd-lang${compact ? "" : " pd-lang--dark"}`}>
      {options.map((option) => {
        const active = locale === option.locale;
        return <button
          key={option.locale}
          type="button"
          aria-pressed={active}
          aria-label={`${t("language.current")}: ${t(option.key)}`}
          disabled={active}
          onClick={() => setLocale(option.locale)}
        >{option.label}</button>;
      })}
    </div>
  );
}
