import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workerPath = resolve(process.cwd(), "apps/web/public/sw.js");

describe("service worker static safety contract", () => {
  it("bypasses every non-GET request and never queues or replays writes", async () => {
    const source = await readFile(workerPath, "utf8");
    expect(source).toContain('if (request.method !== "GET") return;');
    expect(source).not.toMatch(/addEventListener\(["'](?:sync|push)["']/);
    expect(source).not.toMatch(/indexedDB|BackgroundSync/i);
  });

  it("never caches identity or admin API responses", async () => {
    const source = await readFile(workerPath, "utf8");
    // Only the read-only business API whitelist may enter Cache Storage.
    expect(source).toContain('!url.pathname.startsWith("/api/v1/auth/")');
    expect(source).toContain('!url.pathname.startsWith("/api/v1/admin/")');
    expect(source).toContain("if (!isPrivateReadonlyApi(url)) return;");
  });

  it("keeps offline replays network-first, stamped, and owner-purgeable (7.3a)", async () => {
    const source = await readFile(workerPath, "utf8");
    // Fresh data always wins: the cache is only read after fetch() throws.
    expect(source).toMatch(/const response = await fetch\(request\);[\s\S]*catch[\s\S]*caches\.match\(request/);
    // Replayed responses carry the capture timestamp the UI shows as dataAsOf.
    expect(source).toContain('headers.set("x-pulse-cached-at"');
    // Private content lives under its own prefix so logout/user-switch can purge it whole.
    expect(source).toContain('const PRIVATE_CACHE_PREFIX = "pulse-private-"');
    expect(source).toContain("PRIVATE_CACHE_MAX_ENTRIES");
  });

  it("only writes the private cache while an owner is bound (7.3a)", async () => {
    const source = await readFile(workerPath, "utf8");
    // No owner marker → no writes: after a logout purge, anonymous traffic
    // (login page + prefetches) must not resurrect the private cache.
    expect(source).toMatch(/const epochBefore = await readOwnerEpoch\(\);\s*if \(epochBefore === null\) return;/);
    // Eviction never removes the marker itself.
    expect(source).toMatch(/filter\(\(key\) => new URL\(key\.url\)\.pathname !== OWNER_MARKER_PATH\)/);
    // The marker path is the one the page side (private-cache.ts) actually writes.
    const pageSide = await readFile(resolve(process.cwd(), "apps/web/src/features/pwa/private-cache.ts"), "utf8");
    expect(source).toContain('const OWNER_MARKER_PATH = "/__pulse-private-owner"');
    expect(pageSide).toContain('const OWNER_MARKER_PATH = "/__pulse-private-owner"');
  });

  it("self-annuls in-flight writes on purge or rebind (#22 epoch mechanism)", async () => {
    const source = await readFile(workerPath, "utf8");
    // The marker body is re-read AFTER each put and compared with the pre-put value:
    // marker gone (logout purge raced the write) → the whole private cache is deleted;
    // marker changed (rebind to another user/epoch) → this write is deleted.
    expect(source).toMatch(/const epochAfter = await readOwnerEpoch\(\);[\s\S]*?if \(epochAfter === null\) \{\s*await caches\.delete\(PRIVATE_CACHE_NAME\);\s*return;\s*\}[\s\S]*?if \(epochAfter !== epochBefore\) \{\s*await cache\.delete\(request\.url\);\s*return;\s*\}/);
    // The page side mints an epoch per binding and preserves it only on same-owner re-confirms.
    const pageSide = await readFile(resolve(process.cwd(), "apps/web/src/features/pwa/private-cache.ts"), "utf8");
    expect(pageSide).toMatch(/const epoch = sameOwner && previous\?\.epoch \? previous\.epoch : newEpoch\(\);/);
    expect(pageSide).toContain("JSON.stringify({ owner: userId, epoch })");
  });

  it("keeps a versioned shell cache and removes old versions", async () => {
    const source = await readFile(workerPath, "utf8");
    expect(source).toContain("matchday-ledger-shell-");
    expect(source).toContain("key !== CACHE_NAME");
    expect(source).toContain("await caches.match(OFFLINE_URL)");
    expect(source).toContain("if (!response.ok");
  });
});
