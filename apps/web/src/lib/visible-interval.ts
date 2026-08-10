/**
 * The decision half of {@link useVisibleInterval}, kept free of React and of the
 * DOM so it can be unit-tested — the web test environment is `node`, and a
 * timer/visibility state machine buried inside a hook is exactly the kind of
 * thing that only e2e would ever catch getting subtly wrong.
 */
export interface VisibleIntervalHost {
  isHidden(): boolean;
  setInterval(handler: () => void, ms: number): number;
  clearInterval(id: number): void;
  /** Subscribes to visibility changes; the returned function unsubscribes. */
  onVisibilityChange(listener: () => void): () => void;
}

/**
 * Runs `run` every `intervalMs`, but only while the page is being looked at.
 *
 * Two behaviours that hand-rolled polling in this app kept getting half right:
 *
 *  1. A hidden page stops the timer outright rather than waking up to check
 *     visibility and return. A PWA parked in a phone's background is the common
 *     case, and every skipped tick is still a wakeup and a round of requests
 *     that never had a reader.
 *  2. Coming back runs the task immediately. A gate that only skips leaves the
 *     returning reader staring at data up to a full interval old — which is
 *     precisely when they are looking hardest.
 *
 * Returns a teardown function.
 */
export function startVisibleInterval(input: { run: () => void; intervalMs: number; host: VisibleIntervalHost }): () => void {
  const { run, intervalMs, host } = input;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => {};

  let timer: number | null = null;
  const stop = () => { if (timer !== null) { host.clearInterval(timer); timer = null; } };
  const start = () => { stop(); timer = host.setInterval(run, intervalMs); };

  const unsubscribe = host.onVisibilityChange(() => {
    if (host.isHidden()) { stop(); return; }
    // Catch up first, then resume: fresh data now, not one interval from now.
    run();
    start();
  });

  if (!host.isHidden()) start();
  return () => { stop(); unsubscribe(); };
}

/** The real browser wiring. Only ever constructed inside an effect. */
export function browserVisibleIntervalHost(): VisibleIntervalHost {
  return {
    isHidden: () => document.visibilityState === "hidden",
    setInterval: (handler, ms) => window.setInterval(handler, ms),
    clearInterval: (id) => { window.clearInterval(id); },
    onVisibilityChange: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}
