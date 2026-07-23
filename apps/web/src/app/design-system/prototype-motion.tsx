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

    const handleNavigation = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank") return;

      const destination = new URL(anchor.href, window.location.href);
      const sameDocument = destination.pathname === window.location.pathname && destination.search === window.location.search;
      if (destination.origin !== window.location.origin || sameDocument) return;

      event.preventDefault();
      document.documentElement.classList.add("pd-route-leaving");
      window.setTimeout(() => window.location.assign(destination.href), 260);
    };

    document.addEventListener("click", handleNavigation);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", handleNavigation);
    };
  }, []);

  return <span className="pd-route-wipe" aria-hidden="true" />;
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
