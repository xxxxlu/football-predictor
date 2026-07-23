import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createLoggedInActor, createRoomViaApi } from "./support/actors";
import {
  BUMPED_HOME_ODDS,
  SEEDED_HOME_ODDS,
  bumpSeededMarketOdds,
  databaseAvailable,
  restoreSeededMarketOdds,
} from "./support/market-db";

// Tech debt #21 — the offline-resync suite simulates an odds move by rewriting the
// stored draft's version. This journey performs the REAL thing: while the device is
// offline the database receives a new odds snapshot and the market's current_version
// flips (the same write pattern the production supplier sync performs). Reconnecting
// must surface ODDS_CHANGED, refuse the stale draft, and accept a fresh pick at the
// NEW odds end-to-end.
//
// The runner is serial (workers=1, fullyParallel=false), so mutating the shared seeded
// market is safe as long as afterAll restores it before the next spec file runs.

const SEEDED_HOME_TEAM = "E2E 联队";

test.describe.configure({ mode: "serial" });

test.describe("offline draft revalidation against a real server-side repricing (#21)", () => {
  let context: BrowserContext;
  let page: Page;
  let roomId = "";
  let swActive = false;
  let bumped = false;
  const skipUnlessRunnable = () => {
    test.skip(!swActive, "service worker not active on this server (production builds only) — run against `next start`");
    test.skip(!databaseAvailable(), "DATABASE_URL not set — cannot reprice the seeded market server-side");
  };

  const draftKeys = () => page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("pulse-draft-v1:")));
  const awaitNavCached = (id: string) => page.waitForFunction(async (rid) => {
    return Boolean(await caches.match(`/rooms/${rid}`, { cacheName: "pulse-private-v1" }));
  }, id, { timeout: 15_000 });
  const openSlip = async () => {
    const card = page.locator("article").filter({ hasText: SEEDED_HOME_TEAM }).first();
    await expect(card).toBeVisible();
    await expect(async () => {
      if ((await card.locator("details[open]").count()) === 0) await card.getByText("填写本场判断").click();
      expect(await card.locator("details[open]").count()).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });
    return card;
  };
  const reconnectAndAwaitReload = async () => {
    await context.setOffline(false);
    await expect(page.getByText("网络已恢复，正在重新同步最新数据…")).toBeVisible();
    await page.waitForEvent("load", { timeout: 15_000 });
    await expect(page.locator("article").filter({ hasText: SEEDED_HOME_TEAM }).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
  };

  test.beforeAll(async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    context = await browser.newContext();
    page = await context.newPage();
    await createLoggedInActor(page, "repr");
    const room = await createRoomViaApi(page, baseURL, "E2E 真实变价房");
    roomId = room.roomId;

    await page.goto(`/rooms/${roomId}`);
    swActive = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(resolve, 4_000))]);
      return Boolean(navigator.serviceWorker.controller);
    });
    if (!swActive) return;
    await page.waitForFunction(async () => {
      const cache = await caches.open("pulse-private-v1");
      return Boolean(await cache.match("/__pulse-private-owner"));
    });
    await page.goto(`/rooms/${roomId}`);
    await expect(page.locator("article").filter({ hasText: SEEDED_HOME_TEAM }).first()).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => {});
    await awaitNavCached(roomId);
  });

  test.afterAll(async () => {
    // Always restore, even on failure: later spec files submit against the seeded odds.
    if (bumped) await restoreSeededMarketOdds();
    await context?.close();
  });

  test("a real odds bump while offline demands re-pick, then submits at the new odds", async () => {
    skipUnlessRunnable();
    test.setTimeout(90_000);

    await context.setOffline(true);
    try {
      await page.goto(`/rooms/${roomId}`);
      const card = await openSlip();
      // The replayed page still shows the seeded odds — the draft records them.
      await expect(card.getByRole("button", { name: /主胜/ })).toContainText(SEEDED_HOME_ODDS);
      await card.getByRole("button", { name: /主胜/ }).click();
      await card.getByLabel("投入积分").fill("700");
      await expect(card.getByRole("button", { name: "离线中，提交已禁用" })).toBeDisabled();
      await expect.poll(draftKeys, { timeout: 10_000 }).toHaveLength(1);

      // The REAL repricing: a new snapshot + current_version flip, straight in the
      // database, while the browser is still offline (the runner process stays online).
      await bumpSeededMarketOdds();
      bumped = true;
    } finally {
      await reconnectAndAwaitReload();
    }

    const card = await openSlip();
    // The stale draft is announced with ITS odds, and nothing is prefilled.
    await expect(card.getByText("离线草稿需要处理")).toBeVisible();
    await expect(card.getByText(new RegExp(`离线期间积分倍率已变化（草稿倍率 ${SEEDED_HOME_ODDS}）`))).toBeVisible();
    await expect(card.getByRole("button", { name: /主胜/ })).toHaveAttribute("aria-pressed", "false");
    await expect(card.getByRole("button", { name: "确认最新倍率并提交" })).toBeDisabled();
    // The refetched market genuinely carries the NEW odds.
    await expect(card.getByRole("button", { name: /主胜/ })).toContainText(BUMPED_HOME_ODDS);

    // Discard, re-pick at the new odds, and the server accepts the fresh ticket.
    await card.getByRole("button", { name: "丢弃草稿" }).click();
    await expect(card.getByText("离线草稿需要处理")).toBeHidden();
    await expect.poll(draftKeys).toHaveLength(0);
    await card.getByRole("button", { name: /主胜/ }).click();
    await card.getByLabel("投入积分").fill("700");
    await card.getByRole("button", { name: "确认最新倍率并提交" }).click();
    await expect(card.getByText("判断已记录")).toBeVisible({ timeout: 15_000 });
    await expect.poll(draftKeys).toHaveLength(0);
  });
});
