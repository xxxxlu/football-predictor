/*看球账本 Service Worker：只读缓存，不实现后台同步或写请求重放。*/
const CACHE_PREFIX = "matchday-ledger-shell-";
const CACHE_VERSION = "v1";
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/app-icon.svg",
  "/app-icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CLEAR_READONLY_CACHES") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key)))));
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isStaticShell(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname === "/favicon.ico" || PRECACHE_URLS.includes(url.pathname);
}

async function cacheSuccessfulResponse(request, response) {
  if (!response.ok || response.type === "opaque") return response;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  /*所有写操作直接走网络。这里没有 queue、Background Sync 或 replay。*/
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        return await cacheSuccessfulResponse(request, response);
      } catch {
        const cachedNavigation = await caches.match(request);
        return cachedNavigation || await caches.match(OFFLINE_URL) || Response.error();
      }
    })());
    return;
  }

  if (isStaticShell(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try { return await cacheSuccessfulResponse(request, await fetch(request)); }
      catch { return Response.error(); }
    })());
  }
});
