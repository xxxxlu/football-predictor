"use client";

import { useEffect, useRef } from "react";
import { browserVisibleIntervalHost, startVisibleInterval } from "./visible-interval";

/**
 * Polls on an interval, but only while the tab is actually being looked at.
 * See {@link startVisibleInterval} for the behaviour and why it exists.
 *
 * `task` may change every render (it usually closes over state); the newest one
 * is always what fires, and changing it never restarts the timer.
 */
export function useVisibleInterval(task: () => void, intervalMs: number): void {
  const latest = useRef(task);
  useEffect(() => { latest.current = task; }, [task]);

  useEffect(
    () => startVisibleInterval({ run: () => latest.current(), intervalMs, host: browserVisibleIntervalHost() }),
    [intervalMs],
  );
}
