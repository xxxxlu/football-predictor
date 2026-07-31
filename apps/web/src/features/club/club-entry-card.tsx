"use client";
import Link from "next/link";
import { useLocale } from "@/components/locale-provider";

/** Compact entry to the daily challenge, shown on /matches (Story 12.2). */
export function ClubEntryCard() {
  const { locale, t } = useLocale();
  return <Link href="/club/daily"
    className="surface flex flex-wrap items-center gap-4 p-4 no-underline transition hover:brightness-[.98] sm:p-5">
    <span aria-hidden="true" className="display text-2xl">?</span>
    <span className="min-w-0">
      <span className="block font-bold">{t("club.daily.entry")}</span>
      <span className="block text-xs leading-5 text-[var(--muted)]">
        {locale === "en"
          ? "One light sports question a day — club honours only, never room points."
          : "每天一道轻量体育题，附今日运势卡；只算俱乐部荣誉，不涉及任何房间积分。"}
      </span>
    </span>
    <span aria-hidden="true" className="ml-auto font-bold">→</span>
  </Link>;
}
