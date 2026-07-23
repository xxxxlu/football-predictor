"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* PULSE global navigation (§10.1 / §10.2).
   Top nav: 赛事 房间 战绩 排行榜 账户；mobile: fixed 5-tab bottom bar. */

const NAV = [
  { label: "赛事", href: "/matches" },
  { label: "房间", href: "/rooms" },
  { label: "战绩", href: "/history" },
  { label: "排行榜", href: "/leaderboard" },
  { label: "账户", href: "/account" },
] as const;

const BOTTOM = [
  { label: "赛事", href: "/matches", glyph: "M4 12 A8 8 0 1 0 20 12 A8 8 0 1 0 4 12 M12 4 V20 M4 12 H20" },
  { label: "房间", href: "/rooms", glyph: "M4 20 V9 L12 3 L20 9 V20 H14 V13 H10 V20 Z" },
  { label: "战绩", href: "/history", glyph: "M4 20 L4 12 M10 20 L10 6 M16 20 L16 9 M22 20 L2 20" },
  { label: "排行", href: "/leaderboard", glyph: "M3 20 H9 V10 H3 Z M9.5 20 H15.5 V4 H9.5 Z M16 20 H22 V13 H16 Z" },
  { label: "我的", href: "/account", glyph: "M12 11 A4 4 0 1 0 12 3 A4 4 0 0 0 12 11 M4 21 C4 16 8 14 12 14 C16 14 20 16 20 21" },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PulseHeaderNav() {
  const pathname = usePathname();
  return (
    <nav className="pd-header-nav" aria-label="主要导航">
      {NAV.map((item) => (
        <Link key={item.href} href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();
  return (
    <nav className="pd-bottom-nav" aria-label="移动端导航">
      {BOTTOM.map((item) => (
        <Link key={item.href} href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={item.glyph} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
