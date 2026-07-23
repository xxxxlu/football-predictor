/*PULSE Service Worker：只读缓存，不实现后台同步或写请求重放。
  v2（Story 7.3a）：新增 owner 绑定的私有只读缓存 —— 已访问页面与只读 API 响应
  在离线时可回放（带 x-pulse-cached-at 时间戳），登出/用户切换由页面侧整体清除。*/
const CACHE_PREFIX = "pulse-shell-";
const LEGACY_CACHE_PREFIX = "matchday-ledger-shell-";
const PRIVATE_CACHE_PREFIX = "pulse-private-";
const CACHE_VERSION = "v2";
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const PRIVATE_CACHE_NAME = `${PRIVATE_CACHE_PREFIX}v1`;
const PRIVATE_CACHE_MAX_ENTRIES = 150;
/*与 features/pwa/private-cache.ts 保持一致：登录侧写入该标记以绑定缓存归属。*/
const OWNER_MARKER_PATH = "/__pulse-private-owner";
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
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) || key.startsWith(LEGACY_CACHE_PREFIX) || key.startsWith(PRIVATE_CACHE_PREFIX))
      .map((key) => caches.delete(key)))));
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) || key.startsWith(LEGACY_CACHE_PREFIX) || (key.startsWith(PRIVATE_CACHE_PREFIX) && key !== PRIVATE_CACHE_NAME))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isStaticShell(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname === "/favicon.ico" || PRECACHE_URLS.includes(url.pathname);
}

/*离线只读白名单：已访问页面（导航 + RSC payload）和只读业务 API。
  身份与管理面永不落缓存：/api/v1/auth/*、/api/v1/admin/*。*/
function isPrivateReadonlyApi(url) {
  return url.pathname.startsWith("/api/v1/")
    && !url.pathname.startsWith("/api/v1/auth/")
    && !url.pathname.startsWith("/api/v1/admin/");
}

async function cacheSuccessfulResponse(request, response) {
  if (!response.ok || response.type === "opaque") return response;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

/*读取 owner 标记原文（缺失返回 null）。标记体由页面侧写入（private-cache.ts），
  含 owner + 每次绑定唯一的 epoch —— SW 只做原文比较，不解析。*/
async function readOwnerEpoch() {
  const marker = await caches.match(OWNER_MARKER_PATH, { cacheName: PRIVATE_CACHE_NAME });
  return marker ? await marker.text() : null;
}

/*写入私有缓存时盖上时间戳，离线回放时页面据此展示 dataAsOf。
  注意用 request.url 作 key：Cache.put() 拒绝 mode 为 navigate 的 Request 对象。*/
async function putPrivate(request, response) {
  if (!response.ok || response.type === "opaque") return;
  /*只有登录侧绑定过 owner 才写入（caches.match 探测不会创建缓存）：
    登出 purge 之后标记消失，匿名流量（登录页及其 prefetch）不会把私有缓存复活。*/
  const epochBefore = await readOwnerEpoch();
  if (epochBefore === null) return;
  const headers = new Headers(response.headers);
  headers.set("x-pulse-cached-at", new Date().toISOString());
  const body = await response.clone().blob();
  const cache = await caches.open(PRIVATE_CACHE_NAME);
  await cache.put(request.url, new Response(body, { status: response.status, statusText: response.statusText, headers }));
  /*epoch 复核：写入期间发生了登出 purge（标记消失）或换绑（epoch 变化）时，
    这次写入自弃 —— 彻底关闭 in-flight 写复活/串入私有缓存的窗口。*/
  const epochAfter = await readOwnerEpoch();
  if (epochAfter === null) {
    await caches.delete(PRIVATE_CACHE_NAME);
    return;
  }
  if (epochAfter !== epochBefore) {
    await cache.delete(request.url);
    return;
  }
  /*FIFO 淘汰，owner 标记永不参与淘汰。*/
  const keys = (await cache.keys()).filter((key) => new URL(key.url).pathname !== OWNER_MARKER_PATH);
  if (keys.length > PRIVATE_CACHE_MAX_ENTRIES) {
    await Promise.all(keys.slice(0, keys.length - PRIVATE_CACHE_MAX_ENTRIES).map((key) => cache.delete(key)));
  }
}

async function notifyServedFromCache(clientId, request, cachedAt) {
  if (!clientId) return;
  const client = await self.clients.get(clientId);
  client?.postMessage({ type: "OFFLINE_SERVED", url: request.url, cachedAt: cachedAt || null });
}

/*network-first：在线永远走网络并刷新缓存；只有网络失败才回放缓存副本。*/
async function networkFirstPrivate(event, request, offlineFallback) {
  try {
    const response = await fetch(request);
    event.waitUntil(putPrivate(request, response.clone()));
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: PRIVATE_CACHE_NAME });
    if (cached) {
      event.waitUntil(notifyServedFromCache(event.clientId || event.resultingClientId, request, cached.headers.get("x-pulse-cached-at")));
      return cached;
    }
    if (offlineFallback) return await caches.match(OFFLINE_URL) || Response.error();
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  /*所有写操作直接走网络。这里没有 queue、Background Sync 或 replay。*/
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    /*身份、管理与其他未白名单 API 保持直连不缓存。*/
    if (!isPrivateReadonlyApi(url)) return;
    event.respondWith(networkFirstPrivate(event, request, false));
    return;
  }

  if (request.mode === "navigate") {
    /*已访问页面进入 owner 绑定的私有缓存（登出/切换用户整体清除），离线可重开。*/
    event.respondWith(networkFirstPrivate(event, request, true));
    return;
  }

  /*App Router 客户端导航的 RSC payload：同样按已访问页面缓存。*/
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) {
    event.respondWith(networkFirstPrivate(event, request, false));
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
