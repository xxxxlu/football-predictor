"use client";
import { useEffect } from "react";
import type { ApiEnvelope } from "@/features/matchday/types";
import { FRIENDS_POLL_INTERVAL_MS, shouldSendHeartbeat, type PrivacyPreferences } from "./friends-flow";

/**
 * Sends the presence heartbeat on the shared 30–60s cadence while a private
 * page is open — but only after reading the user's own toggles: with both
 * switches off, no request leaves the browser at all. The server re-checks the
 * same consent in SQL either way, so the client check is bandwidth courtesy,
 * not the boundary (FR85).
 */
export function PresenceHeartbeat() {
  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    const beat = () => {
      void fetch("/api/v1/presence/heartbeat", {
        method: "POST", credentials: "same-origin", signal: controller.signal,
      }).catch(() => {});
    };
    void (async () => {
      try {
        const response = await fetch("/api/v1/account/privacy", { credentials: "same-origin", signal: controller.signal });
        if (!response.ok) return;
        const result = (await response.json()) as ApiEnvelope<PrivacyPreferences>;
        if (!shouldSendHeartbeat(result.data)) return;
        beat();
        timer = window.setInterval(beat, FRIENDS_POLL_INTERVAL_MS);
      } catch { /* offline or aborted: stay silent */ }
    })();
    return () => { controller.abort(); if (timer !== undefined) window.clearInterval(timer); };
  }, []);
  return null;
}
