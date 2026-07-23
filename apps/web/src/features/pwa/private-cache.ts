/** Story 7.3a — owner discipline for the service worker's private read-only cache.
 *
 *  The SW replays visited pages and read-only API responses offline. That cache may
 *  only ever serve the account it was recorded for:
 *  - logout purges it entirely (nothing private survives on a shared device);
 *  - a different user logging in purges it before anything renders with stale data.
 *  User switching requires the network (login is an API call), so purging at auth
 *  transitions is sufficient — an offline device can never change accounts.
 */

import { hasOfflineDrafts, purgeOfflineDrafts } from "./offline-draft";

const PRIVATE_CACHE_PREFIX = "pulse-private-";
const OWNER_MARKER_PATH = "/__pulse-private-owner";

function cachesAvailable(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

/** Delete every private cache and offline draft (logout, or ownership change).
 *  Swept in bounded passes: a service-worker write already in flight can pass its
 *  owner check before the purge and land after it, resurrecting the cache — the
 *  re-check catches that (observed as a one-attempt CI flake of the logout spec). */
export async function purgePrivateCaches(): Promise<void> {
  purgeOfflineDrafts();
  if (!cachesAvailable()) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const keys = (await window.caches.keys()).filter((key) => key.startsWith(PRIVATE_CACHE_PREFIX));
    if (keys.length === 0 && attempt > 0) return;
    await Promise.all(keys.map((key) => window.caches.delete(key)));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Bind the private cache to the authenticated user: purge it when the owner changed,
 *  then record the current owner. Call whenever a session is confirmed. */
export async function syncPrivateCacheOwner(userId: string): Promise<void> {
  if (!cachesAvailable() || !userId) return;
  try {
    const keys = await window.caches.keys();
    const privateKeys = keys.filter((key) => key.startsWith(PRIVATE_CACHE_PREFIX));
    let previousOwner: string | null = null;
    let hasEntries = false;
    for (const key of privateKeys) {
      const cache = await window.caches.open(key);
      const marker = await cache.match(OWNER_MARKER_PATH);
      if (marker) previousOwner = previousOwner ?? ((await marker.text()).trim() || null);
      if (!hasEntries && (await cache.keys()).length > 0) hasEntries = true;
    }
    // A different owner — or content of UNKNOWN ownership (marker missing) — never survives.
    // Offline drafts count as content too: marker-less drafts are foreign (7.3b).
    if ((previousOwner !== null && previousOwner !== userId) || (previousOwner === null && (hasEntries || hasOfflineDrafts()))) {
      await purgePrivateCaches();
    }
    // (Re)write the marker into the versioned cache the SW writes to.
    const cache = await window.caches.open(`${PRIVATE_CACHE_PREFIX}v1`);
    await cache.put(OWNER_MARKER_PATH, new Response(userId, { headers: { "content-type": "text/plain" } }));
  } catch { /* 缓存所有权同步失败不阻断页面 —— 最坏情况是下次登录再清一次。 */ }
}
