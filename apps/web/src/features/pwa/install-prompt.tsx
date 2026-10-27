"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "pulse_a2hs_dismissed_until";

export function shouldShowInstallPrompt(input: {
  isStandalone: boolean;
  dismissedUntilMs?: number | null;
  nowMs?: number;
}): boolean {
  if (input.isStandalone) return false;
  if (input.dismissedUntilMs && input.dismissedUntilMs > (input.nowMs ?? Date.now())) {
    return false;
  }
  return true;
}

export function detectPlatform(userAgent: string): { isIOS: boolean; isSafari: boolean } {
  const ua = userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isSafari = /safari/.test(ua) && !/crios|fxios|chrome/.test(ua);
  return { isIOS, isSafari };
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS] = useState(() => {
    if (typeof window === "undefined") return false;
    const p = detectPlatform(window.navigator.userAgent);
    return p.isIOS && p.isSafari;
  });
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. Check if already running in standalone mode (installed)
    const isStandalone =
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;

    const dismissedUntil = localStorage.getItem(DISMISS_KEY);
    const dismissedUntilMs = dismissedUntil ? Number(dismissedUntil) : null;

    if (!shouldShowInstallPrompt({ isStandalone, dismissedUntilMs })) {
      return;
    }

    if (isIOS) {
      const timer = setTimeout(() => setShowPrompt(true), 2500);
      return () => clearTimeout(timer);
    }

    // 4. Chromium / Android beforeinstallprompt
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowPrompt(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, [isIOS]);

  const handleDismiss = (days: number = 7) => {
    setShowPrompt(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + days * 86400000));
    } catch {}
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setShowPrompt(false);
      }
      setDeferredPrompt(null);
    }
  };

  if (!showPrompt) return null;

  return (
    <aside
      role="dialog"
      aria-labelledby="a2hs-title"
      aria-describedby="a2hs-desc"
      className="fixed inset-x-3 bottom-6 z-50 mx-auto max-w-md animate-in fade-in slide-in-from-bottom-5 duration-300"
    >
      <div className="apple-card overflow-hidden rounded-2xl border border-black/10 bg-white/95 p-4 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-black/90">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--pulse-red)] font-black text-white shadow-md shadow-red-500/20">
            <span>P</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 id="a2hs-title" className="text-sm font-bold text-[var(--ink)] dark:text-white">
                添加 PULSE 到主屏幕
              </h3>
              <button
                type="button"
                onClick={() => handleDismiss(7)}
                className="text-xs text-[var(--muted)] hover:text-[var(--ink)]"
                aria-label="关闭提示"
              >
                ✕
              </button>
            </div>
            <p id="a2hs-desc" className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              {isIOS ? (
                <>
                  轻点下方浏览器工具栏的分享按钮{" "}
                  <span className="inline-flex items-center rounded border border-black/10 bg-black/5 px-1 font-mono text-[11px] font-bold dark:border-white/10 dark:bg-white/10">
                    ⎋ 分享
                  </span>
                  ，选择{" "}
                  <strong className="text-[var(--ink)] dark:text-white">「添加到主屏幕 ⊞」</strong>
                  ，即可获得无缝原生全屏与实时赔率推流体验。
                </>
              ) : (
                "将 PULSE 安装到手机主屏幕，享受全屏原生级体验、极速秒开与实时赛事推流。"
              )}
            </p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => handleDismiss(14)}
                className="pressable-btn rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--muted)] transition hover:bg-black/5 dark:hover:bg-white/5"
              >
                稍后再说
              </button>
              {isIOS ? (
                <button
                  type="button"
                  onClick={() => handleDismiss(1)}
                  className="pressable-btn rounded-full bg-[var(--pulse-red)] px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:brightness-110"
                >
                  我知道了
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleInstallClick}
                  className="pressable-btn rounded-full bg-[var(--pulse-red)] px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:brightness-110"
                >
                  立即安装
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
