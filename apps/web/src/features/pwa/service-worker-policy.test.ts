import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workerPath = resolve(process.cwd(), "apps/web/public/sw.js");

describe("service worker static safety contract", () => {
  it("bypasses every non-GET request and all API responses", async () => {
    const source = await readFile(workerPath, "utf8");
    expect(source).toContain('if (request.method !== "GET") return;');
    expect(source).toContain('url.pathname.startsWith("/api/")');
    expect(source).not.toMatch(/addEventListener\(["'](?:sync|push)["']/);
    expect(source).not.toMatch(/indexedDB|BackgroundSync/i);
  });

  it("keeps a versioned shell cache, removes old versions and never persists private navigations", async () => {
    const source = await readFile(workerPath, "utf8");
    expect(source).toContain("matchday-ledger-shell-");
    expect(source).toContain("key !== CACHE_NAME");
    expect(source).toContain("return await fetch(request)");
    expect(source).toContain("await caches.match(OFFLINE_URL)");
    expect(source).not.toContain("cachedNavigation");
    expect(source).not.toContain("return await cacheSuccessfulResponse(request, response)");
    expect(source).toContain("if (!response.ok");
  });
});
