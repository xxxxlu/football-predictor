"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * PULSE route transition + scroll progress. Purely decorative: it never
 * intercepts navigation (no preventDefault / router.push), so Link semantics,
 * prefetch and e2e flows stay untouched. Leaving paints a carbon/red wipe over
 * the old page; the next page (which remounts this component) answers with a
 * finish-line sweep. The hand-off flag lives in sessionStorage with a
 * timestamp so a hard reload or an auth-shell destination never replays it.
 */
const HANDOFF_FLAG = "pulse:route-handoff";
const HANDOFF_MAX_AGE_MS = 2500;
/* Clears the leave wipe if the navigation never commits (e.g. fetch error kept us here). */
const LEAVE_FAILSAFE_MS = 1600;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readHandoff(): boolean {
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_FLAG);
    if (raw === null) return false;
    window.sessionStorage.removeItem(HANDOFF_FLAG);
    return Date.now() - Number(raw) < HANDOFF_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function markHandoff(): void {
  try {
    window.sessionStorage.setItem(HANDOFF_FLAG, String(Date.now()));
  } catch {
    /* 私密模式下没有 sessionStorage：转场退化为无动画，导航不受影响 */
  }
}

export function PulseTransition() {
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const barRef = useRef<HTMLElement>(null);
  const failsafeRef = useRef(0);

  /* Arrival sweep — only after a same-app hand-off, applied post-mount so SSR markup never diverges. */
  useEffect(() => {
    if (prefersReducedMotion() || !readHandoff()) return;
    let timer = 0;
    /* 微任务回调：sessionStorage 是外部系统，且避免 effect 内同步 setState 级联渲染 */
    queueMicrotask(() => {
      setSweeping(true);
      timer = window.setTimeout(() => setSweeping(false), 700);
    });
    return () => window.clearTimeout(timer);
  }, [pathname]);

  /* Leave wipe — capture phase so Next's Link handler (which preventDefaults) hasn't run yet. */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href.startsWith("/")) return;
      const url = new URL(href, window.location.href);
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      markHandoff();
      setLeaving(true);
      window.clearTimeout(failsafeRef.current);
      failsafeRef.current = window.setTimeout(() => setLeaving(false), LEAVE_FAILSAFE_MS);
    };
    /* bfcache restore re-shows the old document: drop any lingering wipe (原型 route-wipe 的已知坑). */
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setLeaving(false);
    };
    const onPopState = () => setLeaving(false);
    document.addEventListener("click", onClick, { capture: true });
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("popstate", onPopState);
      window.clearTimeout(failsafeRef.current);
    };
  }, []);

  /* Scroll progress — writes a CSS var on the bar directly; no re-render per frame. */
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      bar.style.transform = `scaleX(${Math.min(1, Math.max(0, window.scrollY / max))})`;
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <>
      <div className="pulse-progress" aria-hidden="true"><i ref={barRef} /></div>
      {leaving && <div className="pulse-wipe pulse-wipe--leave" aria-hidden="true"><i /><b /></div>}
      {sweeping && <div className="pulse-wipe pulse-wipe--sweep" aria-hidden="true" />}
    </>
  );
}
