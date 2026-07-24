"use client";

import { useEffect, useState } from "react";

/** 原型专用：滚动显现与页面切线，不进入正式业务 Shell。 */
export function PulseMotion() {
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealTargets = Array.from(document.querySelectorAll<HTMLElement>("[data-pd-reveal]"));

    if (reduceMotion || !("IntersectionObserver" in window)) {
      revealTargets.forEach((element) => element.setAttribute("data-pd-revealed", "true"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          (entry.target as HTMLElement).setAttribute("data-pd-revealed", "true");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -12%", threshold: 0.12 },
    );

    revealTargets.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
    };
  }, []);

  return null;
}

export function InteractiveSportSwitcher({ initial = "全部" }: { initial?: string }) {
  const sports = ["全部", "足球", "篮球", "F1"];
  const [active, setActive] = useState(initial);

  return (
    <div className="pd-sport-switch" role="tablist" aria-label="运动切换">
      {sports.map((sport) => (
        <button
          key={sport}
          type="button"
          role="tab"
          aria-selected={sport === active}
          className="pd-sport-pill"
          onClick={() => setActive(sport)}
        >
          <span>{sport}</span>
        </button>
      ))}
    </div>
  );
}
