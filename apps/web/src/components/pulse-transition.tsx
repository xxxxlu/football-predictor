"use client";

import { useEffect, useRef } from "react";

/**
 * PULSE scroll progress. Route-level full-screen wipes were removed: they
 * obscured the destination during normal navigation and created a bright
 * left-to-right flash for motion-sensitive users. Navigation remains native;
 * this layer is now a quiet, information-bearing progress rail only.
 */

export function PulseTransition() {
  const barRef = useRef<HTMLElement>(null);

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
    <div className="pulse-progress" aria-hidden="true"><i ref={barRef} /></div>
  );
}
