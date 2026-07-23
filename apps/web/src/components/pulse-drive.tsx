"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The small interaction signature for PULSE pages: a vertical drive rail and
 * a restrained pointer spotlight. It is visual only; it never owns navigation
 * or prediction state.
 */
export function PulseDrive({ children, className = "" }: { children: ReactNode; className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let frame = 0;
    const updateProgress = () => {
      frame = 0;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const progress = Math.min(1, Math.max(0, window.scrollY / max));
      root.style.setProperty("--pulse-drive-progress", String(progress));
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateProgress);
    };
    const onPointerMove = (event: PointerEvent) => {
      const bounds = root.getBoundingClientRect();
      root.style.setProperty("--pulse-pointer-x", `${event.clientX - bounds.left}px`);
      root.style.setProperty("--pulse-pointer-y", `${event.clientY - bounds.top}px`);
    };
    const resetPointer = () => {
      root.style.setProperty("--pulse-pointer-x", "50%");
      root.style.setProperty("--pulse-pointer-y", "22%");
    };

    updateProgress();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerleave", resetPointer);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerleave", resetPointer);
    };
  }, []);

  return <div ref={rootRef} className={`pulse-drive ${className}`}>{children}<div className="pulse-drive__spot" aria-hidden="true" /><aside className="pulse-drive__rail" aria-hidden="true"><span>SCROLL / DRIVE</span><i /><b>00—100</b></aside></div>;
}
