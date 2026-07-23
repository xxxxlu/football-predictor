"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** Story 7.3a — global offline awareness.
 *
 *  - `useOnlineStatus()`: submit surfaces disable themselves while offline.
 *  - `<OfflineStatusBanner/>` (root layout): announces read-only mode with the oldest
 *    dataAsOf of any cache-served response on this page, and on reconnect reloads the
 *    page so every server state (session, 封盘, balances) is revalidated. Nothing is
 *    queued or replayed — a reload can only re-read.
 */

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** Oldest x-pulse-cached-at reported by the service worker for this page's responses. */
function useServedFromCacheAt(): string | null {
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "OFFLINE_SERVED") return;
      const at = typeof event.data.cachedAt === "string" ? event.data.cachedAt : null;
      if (!at) return;
      setCachedAt((current) => (current === null || at < current ? at : current));
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);
  return cachedAt;
}

export function OfflineStatusBanner() {
  const online = useOnlineStatus();
  const cachedAt = useServedFromCacheAt();
  const wasOffline = useRef(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!online) { wasOffline.current = true; return; }
    if (!wasOffline.current) return;
    // Reconnected after a real offline stretch: revalidate EVERYTHING by reloading.
    // Read-only mode means there is no in-progress input to lose, and no stale draft
    // can auto-submit — a navigation only re-reads.
    setReloading(true);
    const timer = setTimeout(() => window.location.reload(), 1_200);
    return () => clearTimeout(timer);
  }, [online]);

  if (online && !reloading) return null;
  return (
    <aside role="status" aria-live="polite" className="fixed inset-x-0 top-0 z-50 border-b-2 border-[var(--ink)] bg-[var(--pulse-carbon,#111)] px-4 py-2.5 text-center text-sm font-bold text-white">
      {reloading
        ? "网络已恢复，正在重新同步最新数据…"
        : <>离线只读模式：提交已禁用，恢复网络后请确认最新数据再操作。
            {cachedAt && <span className="ml-2 font-normal opacity-80">数据截至 <time dateTime={cachedAt}>{new Date(cachedAt).toLocaleString("zh-CN")}</time></span>}
          </>}
    </aside>
  );
}
