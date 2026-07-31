"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "./locale-provider";

/* PULSE global navigation (§10.1 / §10.2, widened by Story 12.4).
   Top nav: 赛事 房间 俱乐部 战绩 排行榜 账户；mobile: fixed 6-tab bottom bar.
   Both bottom-nav CSS copies (globals.css + design-system/pulse.css) carry the
   matching grid-template-columns: repeat(6, 1fr) — change them together. */

const NAV = [
  { labelKey: "nav.matches", href: "/matches" },
  { labelKey: "nav.rooms", href: "/rooms" },
  { labelKey: "nav.club", href: "/club" },
  { labelKey: "nav.history", href: "/history" },
  { labelKey: "nav.leaderboard", href: "/leaderboard" },
  { labelKey: "nav.accountLabel", href: "/account" },
] as const;

const BOTTOM = [
  { labelKey: "nav.matches", href: "/matches", glyph: "M4 12 A8 8 0 1 0 20 12 A8 8 0 1 0 4 12 M12 4 V20 M4 12 H20" },
  { labelKey: "nav.rooms", href: "/rooms", glyph: "M4 20 V9 L12 3 L20 9 V20 H14 V13 H10 V20 Z" },
  { labelKey: "nav.club", href: "/club", glyph: "M12 3 L14.4 8.9 L20.8 9.4 L16 13.6 L17.6 19.9 L12 16.5 L6.4 19.9 L8 13.6 L3.2 9.4 L9.6 8.9 Z" },
  { labelKey: "nav.history", href: "/history", glyph: "M4 20 L4 12 M10 20 L10 6 M16 20 L16 9 M22 20 L2 20" },
  { labelKey: "nav.rank", href: "/leaderboard", glyph: "M3 20 H9 V10 H3 Z M9.5 20 H15.5 V4 H9.5 Z M16 20 H22 V13 H16 Z" },
  { labelKey: "nav.me", href: "/account", glyph: "M12 11 A4 4 0 1 0 12 3 A4 4 0 0 0 12 11 M4 21 C4 16 8 14 12 14 C16 14 20 16 20 21" },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PulseHeaderNav() {
  const pathname = usePathname();
  const { t } = useLocale();
  return (
    <nav className="pd-header-nav" aria-label={t("nav.primary")}>
      {NAV.map((item) => (
        <Link key={item.href} href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
          {t(item.labelKey)}
        </Link>
      ))}
    </nav>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const { t } = useLocale();
  return (
    <nav className="pd-bottom-nav" aria-label={t("nav.mobile")}>
      {BOTTOM.map((item) => (
        <Link key={item.href} href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={item.glyph} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{t(item.labelKey)}</span>
        </Link>
      ))}
    </nav>
  );
}
