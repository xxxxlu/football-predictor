"use client";

import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { MobileBottomNav, PulseHeaderNav } from "./pulse-nav";
import { LanguageSwitcher } from "./language-switcher";
import { useLocale } from "./locale-provider";



export function AppShell({ children, username, sessionPending = false }: { children: React.ReactNode; username?: string; sessionPending?: boolean }) {
  const { t } = useLocale();
  return <div className="pd-has-bottom-nav min-h-screen">
    <header className="pd-header">
      <div className="pd-header-inner">
        <BrandMark tone="light" />
        <PulseHeaderNav />
        <div className="ml-auto flex items-center gap-3 sm:gap-4">
          <LanguageSwitcher compact />
          {sessionPending ? <span className="text-xs text-white/60">{t("auth.sessionPending")}</span> : username ? <nav aria-label={t("nav.account")} className="flex items-center gap-3 sm:gap-4"><Link href="/rooms" className="whitespace-nowrap text-sm font-bold text-white underline-offset-4 hover:underline">{t("auth.enterRoom")}</Link><Link href="/account" className="btn-volt !min-h-0 !px-4 !py-2 text-sm">{username}</Link></nav> : <nav aria-label={t("nav.account")} className="flex items-center gap-3 sm:gap-4"><Link href="/login" className="text-sm font-bold text-white underline-offset-4 hover:underline">{t("auth.login")}</Link><Link href="/register" className="btn-volt !min-h-0 !px-4 !py-2 text-sm">{t("auth.register")}</Link></nav>}
        </div>
      </div>
    </header>
    {children}
    <footer className="night border-t border-[var(--night-line)] px-4 py-10 text-center text-xs leading-5 text-white/55">{t("footer.disclaimer")}</footer>
    <MobileBottomNav />
  </div>;
}
