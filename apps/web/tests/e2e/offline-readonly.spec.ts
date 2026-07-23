import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createLoggedInActor, createRoomViaApi, uniqueUsername, registerActor, loginActor } from "./support/actors";

// Story 7.3a — offline read-only journeys, run against the production build (the
// service worker never registers in dev; the suite self-skips there with the reason
// in the report — skipped, never a false pass).
//
//   1. A previously visited page reopens offline: read-only content renders with the
//      offline banner + dataAsOf, and the prediction slip's submit is disabled.
//   2. A different user logging in cannot read the previous account's cached data.
//   3. Logout leaves no private cache on the device.

const SEEDED_HOME_TEAM = "E2E 联队";

test.describe.configure({ mode: "serial" });

test.describe("offline read-only (7.3a)", () => {
  let context: BrowserContext;
  let page: Page;
  let roomId = "";
  let swActive = false;
  const skipUnlessSw = () => {
    test.skip(!swActive, "service worker not active on this server (production builds only) — run against `next start`");
  };

  test.beforeAll(async ({ browser, baseURL }) => {
    // register + login + SW activation + owner binding + cache priming — well over
    // the default 30s hook budget on a cold production server.
    test.setTimeout(120_000);
    context = await browser.newContext();
    page = await context.newPage();
    await createLoggedInActor(page, "offl");
    const room = await createRoomViaApi(page, baseURL, "E2E 离线只读房");
    roomId = room.roomId;

    // Wait for the service worker to control the page, THEN prime the private cache:
    // only requests made under SW control land in Cache Storage.
    await page.goto(`/rooms/${roomId}`);
    swActive = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(resolve, 4_000))]);
      return Boolean(navigator.serviceWorker.controller);
    });
    if (!swActive) return;
    // The SW only caches while an owner is bound (marker written by SessionGuard
    // once the session is confirmed) — wait for the binding before priming.
    await page.waitForFunction(async () => {
      const cache = await caches.open("pulse-private-v1");
      return Boolean(await cache.match("/__pulse-private-owner"));
    });
    await page.goto(`/rooms/${roomId}`);
    await expect(page.locator("article").filter({ hasText: SEEDED_HOME_TEAM }).first()).toBeVisible();
    // Let the in-flight fetches finish so their responses land in the cache.
    await page.waitForLoadState("networkidle").catch(() => {});
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("a visited page reopens offline: read-only + dataAsOf + submit disabled", async () => {
    skipUnlessSw();
    await context.setOffline(true);
    try {
      await page.goto(`/rooms/${roomId}`);

      // Read-only content replays from the private cache.
      const card = page.locator("article").filter({ hasText: SEEDED_HOME_TEAM }).first();
      await expect(card).toBeVisible();

      // Offline is announced, with the capture time of the replayed data.
      const banner = page.getByRole("status").filter({ hasText: "离线只读模式" });
      await expect(banner).toBeVisible();
      await expect(banner.getByText("数据截至")).toBeVisible();

      // The submission surface is disabled outright — not just failing on POST.
      await card.getByText("填写本场判断").click();
      const submit = card.getByRole("button", { name: "离线中，提交已禁用" });
      await expect(submit).toBeVisible();
      await expect(submit).toBeDisabled();
    } finally {
      await context.setOffline(false);
    }

    // Reconnect: the app revalidates by reloading — nothing is queued or replayed.
    // The reload fires ~1.2s after reconnect; wait for the NEXT load event (the
    // current document's load state would resolve immediately, pre-reload).
    await expect(page.getByText("网络已恢复，正在重新同步最新数据…")).toBeVisible();
    await page.waitForEvent("load", { timeout: 15_000 });
    await expect(page.locator("article").filter({ hasText: SEEDED_HOME_TEAM }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("a different user logging in cannot read the previous account's cache", async () => {
    skipUnlessSw();
    // The previous account's room API response is in the cache right now.
    const roomApiCached = () => page.evaluate(async (id) => {
      const cache = await caches.open("pulse-private-v1");
      return Boolean(await cache.match(`/api/v1/rooms/${id}`));
    }, roomId);
    expect(await roomApiCached(), "precondition: first account's data is cached").toBe(true);

    const secondUser = uniqueUsername("offlb");
    await registerActor(page, secondUser);
    await loginActor(page, secondUser);
    await page.goto("/rooms");
    await page.waitForLoadState("networkidle").catch(() => {});

    expect(await roomApiCached(), "previous account's cached data must be purged").toBe(false);
  });

  test("logout leaves no private cache on the device", async () => {
    skipUnlessSw();
    await page.goto("/account");
    await page.getByRole("button", { name: "退出当前会话" }).click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });

    const privateCaches = await page.evaluate(async () =>
      (await caches.keys()).filter((key) => key.startsWith("pulse-private-")));
    expect(privateCaches).toEqual([]);
  });
});
