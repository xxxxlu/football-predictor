import { describe, expect, it, vi } from "vitest";
import { startVisibleInterval, type VisibleIntervalHost } from "./visible-interval.js";

/** A fake page: timers only fire when the test says so, and visibility only
 *  changes when the test flips it. */
function fakePage(input: { hidden?: boolean } = {}) {
  let hidden = input.hidden ?? false;
  let nextId = 1;
  const timers = new Map<number, { handler: () => void; ms: number }>();
  const listeners = new Set<() => void>();

  const host: VisibleIntervalHost = {
    isHidden: () => hidden,
    setInterval: (handler, ms) => { const id = nextId++; timers.set(id, { handler, ms }); return id; },
    clearInterval: (id) => { timers.delete(id); },
    onVisibilityChange: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };

  const announce = () => { for (const listener of [...listeners]) listener(); };
  return {
    host,
    tick: () => { for (const timer of [...timers.values()]) timer.handler(); },
    timerCount: () => timers.size,
    intervals: () => [...timers.values()].map((timer) => timer.ms),
    listenerCount: () => listeners.size,
    hide: () => { hidden = true; announce(); },
    show: () => { hidden = false; announce(); },
  };
}

describe("startVisibleInterval", () => {
  it("runs on the interval while the page is visible", () => {
    const page = fakePage();
    const run = vi.fn();
    startVisibleInterval({ run, intervalMs: 30_000, host: page.host });

    expect(page.intervals()).toEqual([30_000]);
    page.tick();
    page.tick();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("schedules nothing at all when the page starts hidden", () => {
    // A room opened in a background tab should not be polling before anyone
    // has ever looked at it.
    const page = fakePage({ hidden: true });
    const run = vi.fn();
    startVisibleInterval({ run, intervalMs: 30_000, host: page.host });

    expect(page.timerCount()).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it("clears the timer on hide rather than waking up to skip", () => {
    // The distinction that matters: a gate inside the callback still costs a
    // wakeup every interval for as long as the tab stays backgrounded.
    const page = fakePage();
    const run = vi.fn();
    startVisibleInterval({ run, intervalMs: 30_000, host: page.host });

    page.hide();
    expect(page.timerCount()).toBe(0);
    page.tick();
    expect(run).not.toHaveBeenCalled();
  });

  it("catches up immediately on return, then resumes ticking", () => {
    const page = fakePage();
    const run = vi.fn();
    startVisibleInterval({ run, intervalMs: 30_000, host: page.host });
    page.hide();

    page.show();
    expect(run).toHaveBeenCalledTimes(1);
    expect(page.timerCount()).toBe(1);
    page.tick();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps exactly one timer across repeated hide/show cycles", () => {
    const page = fakePage();
    startVisibleInterval({ run: () => {}, intervalMs: 30_000, host: page.host });

    for (let cycle = 0; cycle < 3; cycle += 1) { page.hide(); page.show(); }
    expect(page.timerCount()).toBe(1);
  });

  it("stops the timer and unsubscribes on teardown", () => {
    const page = fakePage();
    const run = vi.fn();
    const teardown = startVisibleInterval({ run, intervalMs: 30_000, host: page.host });

    teardown();
    expect(page.timerCount()).toBe(0);
    expect(page.listenerCount()).toBe(0);
    page.show();
    expect(run).not.toHaveBeenCalled();
  });

  it("never schedules a non-positive or non-finite interval", () => {
    for (const intervalMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const page = fakePage();
      const teardown = startVisibleInterval({ run: () => {}, intervalMs, host: page.host });
      expect(page.timerCount()).toBe(0);
      expect(page.listenerCount()).toBe(0);
      expect(() => teardown()).not.toThrow();
    }
  });
});
