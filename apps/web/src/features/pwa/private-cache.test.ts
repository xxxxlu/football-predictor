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

let storage: FakeCacheStorage;

beforeEach(() => {
  storage = new FakeCacheStorage();
  (globalThis as Record<string, unknown>).window = { caches: storage };
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

  it("binds an empty cache to the confirmed user without purging shell caches", async () => {
    await storage.open("pulse-shell-v2");
    await syncPrivateCacheOwner("user-a");
    expect(await storage.keys()).toContain("pulse-shell-v2");
    const cache = await storage.open("pulse-private-v1");
    expect(await (await cache.match("/__pulse-private-owner"))!.text()).toBe("user-a");
  });
});
