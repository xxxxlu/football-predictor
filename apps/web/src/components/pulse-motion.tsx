"use client";

import { useEffect } from "react";

/** Production motion layer: reveal only, never owns navigation or business state. */
export function PulseMotion() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const reveal = (target: HTMLElement) => {
      target.dataset.pulseRevealed = "true";
    };
    const targets = () => Array.from(document.querySelectorAll<HTMLElement>("[data-pulse-reveal]"));

    if (reduced || !("IntersectionObserver" in window)) {
      targets().forEach(reveal);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        reveal(entry.target as HTMLElement);
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -10%", threshold: 0.12 });

    const observeTargets = (root: ParentNode = document) => {
      const candidates = root instanceof HTMLElement && root.matches("[data-pulse-reveal]")
        ? [root, ...root.querySelectorAll<HTMLElement>("[data-pulse-reveal]")]
        : Array.from(root.querySelectorAll<HTMLElement>("[data-pulse-reveal]"));
      candidates.forEach((target) => {
        if (target.dataset.pulseRevealed !== "true") observer.observe(target);
      });
    };
    observeTargets();
    const mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) observeTargets(node as Element);
      }));
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    return () => { mutationObserver.disconnect(); observer.disconnect(); };
  }, []);

  return null;
}
