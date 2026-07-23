import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { purgePrivateCaches, syncPrivateCacheOwner } from "./private-cache";

/** Minimal in-memory CacheStorage: just what private-cache.ts touches. */
class FakeCache {
  store = new Map<string, Response>();
  async match(path: string) { return this.store.get(path); }
  async put(path: string, response: Response) { this.store.set(path, response); }
  async keys() { return Array.from(this.store.keys()); }
}
class FakeCacheStorage {
  caches = new Map<string, FakeCache>();
  async keys() { return Array.from(this.caches.keys()); }
  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name)!;
  }
  async delete(name: string) { return this.caches.delete(name); }
}

class FakeLocalStorage {
  map = new Map<string, string>();
  get length() { return this.map.size; }
  key(index: number) { return Array.from(this.map.keys())[index] ?? null; }
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

let storage: FakeCacheStorage;
let localStorage: FakeLocalStorage;

const DRAFT = JSON.stringify({ v: 1, roomId: "r", eventKey: "m", marketId: "1", marketVersion: "v1", selection: "HOME", decimalOdds: "3.00", stakePoints: "500", savedAt: "2026-07-23T00:00:00.000Z" });

beforeEach(() => {
  storage = new FakeCacheStorage();
  localStorage = new FakeLocalStorage();
  (globalThis as Record<string, unknown>).window = { caches: storage, localStorage };
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

async function seedPrivateCache(owner: string | null, entries: string[]) {
  const cache = await storage.open("pulse-private-v1");
  if (owner !== null) await cache.put("/__pulse-private-owner", new Response(owner));
  for (const entry of entries) await cache.put(entry, new Response("cached"));
}

describe("private cache owner discipline (7.3a)", () => {
  it("purge deletes every pulse-private-* cache and nothing else", async () => {
    await seedPrivateCache("user-a", ["/api/v1/rooms"]);
    await storage.open("pulse-shell-v2");
    await purgePrivateCaches();
    expect(await storage.keys()).toEqual(["pulse-shell-v2"]);
  });

  it("keeps the cache when the same owner confirms a session", async () => {
    await seedPrivateCache("user-a", ["/api/v1/rooms"]);
    await syncPrivateCacheOwner("user-a");
    const cache = await storage.open("pulse-private-v1");
    expect(await cache.match("/api/v1/rooms")).toBeDefined();
    expect(await (await cache.match("/__pulse-private-owner"))!.text()).toBe("user-a");
  });

  it("purges another user's cache before rebinding (no cross-account reads)", async () => {
    await seedPrivateCache("user-a", ["/api/v1/rooms", "/rooms"]);
    await syncPrivateCacheOwner("user-b");
    const cache = await storage.open("pulse-private-v1");
    expect(await cache.match("/api/v1/rooms")).toBeUndefined();
    expect(await cache.match("/rooms")).toBeUndefined();
    expect(await (await cache.match("/__pulse-private-owner"))!.text()).toBe("user-b");
  });

  it("treats marker-less content as foreign and purges it", async () => {
    await seedPrivateCache(null, ["/api/v1/rooms"]);
    await syncPrivateCacheOwner("user-b");
    const cache = await storage.open("pulse-private-v1");
    expect(await cache.match("/api/v1/rooms")).toBeUndefined();
    expect(await (await cache.match("/__pulse-private-owner"))!.text()).toBe("user-b");
  });

  it("purge deletes offline drafts too (7.3b — drafts are private data)", async () => {
    await seedPrivateCache("user-a", ["/api/v1/rooms"]);
    localStorage.setItem("pulse-draft-v1:r:m", DRAFT);
    localStorage.setItem("unrelated-key", "keep-me");
    await purgePrivateCaches();
    expect(localStorage.getItem("pulse-draft-v1:r:m")).toBeNull();
    expect(localStorage.getItem("unrelated-key")).toBe("keep-me");
  });

  it("another user's drafts never survive an owner change (7.3b)", async () => {
    await seedPrivateCache("user-a", []);
    localStorage.setItem("pulse-draft-v1:r:m", DRAFT);
    await syncPrivateCacheOwner("user-b");
    expect(localStorage.getItem("pulse-draft-v1:r:m")).toBeNull();
  });

  it("marker-less drafts are foreign content and get purged on session confirm (7.3b)", async () => {
    localStorage.setItem("pulse-draft-v1:r:m", DRAFT);
    await syncPrivateCacheOwner("user-b");
    expect(localStorage.getItem("pulse-draft-v1:r:m")).toBeNull();
    const cache = await storage.open("pulse-private-v1");
    expect(await (await cache.match("/__pulse-private-owner"))!.text()).toBe("user-b");
  });

  it("the same owner's drafts survive a session confirm (7.3b)", async () => {
    await seedPrivateCache("user-a", []);
    localStorage.setItem("pulse-draft-v1:r:m", DRAFT);
    await syncPrivateCacheOwner("user-a");
    expect(localStorage.getItem("pulse-draft-v1:r:m")).toBe(DRAFT);
  });

  it("binds an empty cache to the confirmed user without purging shell caches", async () => {
    await storage.open("pulse-shell-v2");
    await syncPrivateCacheOwner("user-a");
    expect(await storage.keys()).toContain("pulse-shell-v2");
    const cache = await storage.open("pulse-private-v1");
    expect(await (await cache.match("/__pulse-private-owner"))!.text()).toBe("user-a");
  });
});
