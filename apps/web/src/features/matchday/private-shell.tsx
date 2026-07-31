"use client";

import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLocale } from "@/components/locale-provider";
import { PulseHeaderNav, MobileBottomNav } from "@/components/pulse-nav";
import { PulseLine } from "@/components/pulse";
import { PulseMotion } from "@/components/pulse-motion";
import { PulseTransition } from "@/components/pulse-transition";
import { sharedPageCopy } from "@/lib/i18n/messages";
import { SessionGuard } from "@/features/auth/session-guard";
import { PresenceHeartbeat } from "@/features/friends/presence-heartbeat";

export function PrivateShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  const { locale, t } = useLocale();
  const localizedCopy = locale === "en" ? sharedPageCopy[title] : undefined;
  const displayTitle = localizedCopy?.title ?? title;
  const displayDescription = localizedCopy?.description ?? description;
  const section = title === "F1 赛程" ? t("page.section.f1") : t("page.section.events");

  return <SessionGuard>
    <div className="pd-has-bottom-nav min-h-screen">
      <PresenceHeartbeat />
      <PulseMotion />
      <PulseTransition />
      <header className="pd-header">
        <div className="pd-header-inner">
          <BrandMark tone="light" />
          <PulseHeaderNav />
          <div className="ml-auto"><LanguageSwitcher compact /></div>
        </div>
      </header>
      <section className="pd-page-lead night relative overflow-hidden">
        <PulseLine state="ambient" className="pointer-events-none absolute inset-x-0 bottom-6 hidden h-7 w-full opacity-60 md:block" />
        <div className="mx-auto max-w-7xl px-4 py-10 md:px-8 md:py-16" data-pulse-reveal>
          <p className="pd-eyebrow">PULSE SPORTS CLUB</p>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="pd-page-lead__index">FIELD NOTE / {section}</p>
              <h1 className="kinetic mt-3 text-[clamp(3.25rem,9vw,7rem)]">{displayTitle}</h1>
            </div>
            <p className="max-w-md leading-7 text-white/65">{displayDescription}</p>
          </div>
        </div>
      </section>
      <main id="main-content" className="mx-auto max-w-7xl px-4 py-10 md:px-8 md:py-16">{children}</main>
      <footer className="night border-t border-[var(--night-line)] px-4 py-8 text-center text-[11px] leading-5 text-white/50">{t("footer.shortDisclaimer")}</footer>
      <MobileBottomNav />
    </div>
  </SessionGuard>;
}
