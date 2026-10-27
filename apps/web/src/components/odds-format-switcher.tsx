"use client";

import { useOddsFormat } from "./odds-format-provider";
import { useLocale } from "./locale-provider";
import type { OddsFormat } from "@/lib/odds-format";
import type { MessageKey } from "@/lib/i18n/messages";

const options: Array<{ format: OddsFormat; key: MessageKey; example: string }> = [
  { format: "decimal", key: "odds.decimal", example: "2.10" },
  { format: "fractional", key: "odds.fractional", example: "11/10" },
  { format: "american", key: "odds.american", example: "+110" },
];

export function OddsFormatSwitcher({ compact = false }: { compact?: boolean }) {
  const { oddsFormat, setOddsFormat } = useOddsFormat();
  const { t } = useLocale();

  return (
    <div
      role="group"
      aria-label={t("odds.format")}
      className="inline-flex items-center rounded-lg border border-[var(--line)] bg-[var(--wash-neutral-soft)] p-0.5 text-xs font-bold"
    >
      {options.map((opt) => {
        const active = oddsFormat === opt.format;
        return (
          <button
            key={opt.format}
            type="button"
            aria-pressed={active}
            onClick={() => setOddsFormat(opt.format)}
            className={`pressable-btn cursor-pointer rounded-md px-2.5 py-1 text-xs transition ${
              active
                ? "bg-[var(--pulse-red)] text-white shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            <span>{t(opt.key)}</span>
            {!compact && <span className="tabular ml-1 opacity-75">({opt.example})</span>}
          </button>
        );
      })}
    </div>
  );
}
