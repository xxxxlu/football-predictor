"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Sport = "FOOTBALL" | "FORMULA_1";

const tabs: ReadonlyArray<{ sport: Sport; href: string; label: string; detail: string }> = [
  { sport: "FOOTBALL", href: "/matches", label: "足球", detail: "FOOTBALL / MATCHDAY" },
  { sport: "FORMULA_1", href: "/matches/f1", label: "F1 赛车", detail: "FORMULA 1 / PADDOCK" },
];

/** 赛事中心的运动切换：一次导航只接受一次点击。切换动画完成后才发起路由，
 * 避免用户连点同一入口制造重复的页面/API 请求。 */
export function SportTabs({ active }: { active: Sport }) {
  const router = useRouter();
  const [switchingTo, setSwitchingTo] = useState<Sport | null>(null);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => { if (resetTimer.current !== null) window.clearTimeout(resetTimer.current); }, []);

  function switchSport(sport: Sport, href: string) {
    if (sport === active || switchingTo !== null) return;
    setSwitchingTo(sport);
    // Leave enough time for the visual hand-off to register, then make exactly one
    // client navigation. The safety reset leaves the UI retryable if navigation fails.
    window.setTimeout(() => router.push(href), 180);
    resetTimer.current = window.setTimeout(() => setSwitchingTo(null), 10_000);
  }

  return (
    <nav aria-label="切换运动" aria-busy={switchingTo !== null} className="pd-sport-switch">
      {tabs.map((tab) => {
        const isActive = active === tab.sport;
        const isSwitching = switchingTo === tab.sport;
        return (
          <button
            key={tab.sport}
            type="button"
            disabled={isActive || switchingTo !== null}
            aria-current={isActive ? "page" : undefined}
            aria-label={isSwitching ? `正在切换到${tab.label}` : `切换到${tab.label}`}
            className={`pd-sport-pill${isActive ? " is-active" : ""}${isSwitching ? " is-switching" : ""}`}
            onClick={() => switchSport(tab.sport, tab.href)}
          >
            <span>{tab.label}</span>
            <small>{isSwitching ? "SWITCHING / 正在载入" : tab.detail}</small>
          </button>
        );
      })}
      <span className="sr-only" aria-live="polite">{switchingTo ? "正在切换赛事，已锁定重复点击。" : ""}</span>
    </nav>
  );
}
