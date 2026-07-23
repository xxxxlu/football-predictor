import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createLoggedInActor, createRoomViaApi, uniqueUsername, registerActor, loginActor } from "./support/actors";

// Story 7.3b — reconnect resync + offline draft revalidation, against the production
// build (the service worker never registers in dev; the suite self-skips there with
// the reason in the report — skipped, never a false pass).
//
//   1. Reconnecting refetches private data: the replayed dataAsOf stamp moves forward.
//   2. An offline draft is restored after the reconnect reload but NEVER auto-submitted,
//      and restoring twice still submits nothing until the user presses submit.
//   3. A draft whose odds moved while offline demands an explicit re-pick or discard.
//   4. Drafts never leak across accounts: logging in as someone else purges them.
//
// The odds movement in (3) is simulated by rewriting the stored draft's market version
// (the client contract is identical to a server-side odds bump that happened while the
// device was offline — the stored version simply no longer matches the live market).

const SEEDED_HOME_TEAM = "E2E 联队";

test.describe.configure({ mode: "serial" });

test.describe("offline resync and draft revalidation (7.3b)", () => {
  let context: BrowserContext;
  let page: Page;
  let roomId = "";
  let swActive = false;
  const skipUnlessSw = () => {
    test.skip(!swActive, "service worker not active on this server (production builds only) — run against `next start`");
  };

  const draftKeys = () => page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith("pulse-draft-v1:")));
  const roomApiCachedAt = () => page.evaluate(async (id) => {
    const cached = await caches.match(`/api/v1/rooms/${id}`, { cacheName: "pulse-private-v1" });
    return cached?.headers.get("x-pulse-cached-at") ?? null;
  }, roomId);
  const openSlip = async () => {
    const card = page.locator("article").filter({ hasText: SEEDED_HOME_TEAM }).first();
    await expect(card).toBeVisible();
    // The disclosure is a plain <details>; a remount (e.g. a racing content swap)
    // resets it to closed, so open-and-verify instead of a single blind click.
    await expect(async () => {
      if ((await card.locator("details[open]").count()) === 0) await card.getByText("填写本场判断").click();
      expect(await card.locator("details[open]").count()).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });
    return card;
  };
  const reconnectAndAwaitReload = async () => {
    await context.setOffline(false);
    await expect(page.getByText("网络已恢复，正在重新同步最新数据…")).toBeVisible();
    // The resync reload fires ~1.2s after reconnect. waitForLoadState would resolve
    // against the CURRENT (pre-reload) document — wait for the NEXT load event instead,
    // otherwise every follow-up action lands on a document about to be thrown away.
    await page.waitForEvent("load", { timeout: 15_000 });
    await expect(page.locator("article").filter({ hasText: SEEDED_HOME_TEAM }).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
  };

  test.beforeAll(async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    context = await browser.newContext();
    page = await context.newPage();
    await createLoggedInActor(page, "resy");
    const room = await createRoomViaApi(page, baseURL, "E2E 重同步房");
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
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("reconnecting refetches private data and moves dataAsOf forward", async () => {
    skipUnlessSw();
    const before = await roomApiCachedAt();
    expect(before, "precondition: the room API response is cached with a stamp").toBeTruthy();

    await context.setOffline(true);
    try {
      await page.goto(`/rooms/${roomId}`);
      await expect(page.getByRole("status").filter({ hasText: "离线只读模式" })).toBeVisible();
    } finally {
      await reconnectAndAwaitReload();
    }

    // Fresh fetches re-stamp the replayed copies: dataAsOf must move forward.
    await expect.poll(roomApiCachedAt, { timeout: 15_000 }).not.toBe(before);
    const after = await roomApiCachedAt();
    expect(String(after) > String(before), `dataAsOf must advance (${before} → ${after})`).toBe(true);
    await expect(page.getByRole("status").filter({ hasText: "离线只读模式" })).toBeHidden();
  });

  test("an offline draft restores after reconnect but is never auto-submitted", async () => {
    skipUnlessSw();
    await context.setOffline(true);
    try {
      await page.goto(`/rooms/${roomId}`);
      const card = await openSlip();
      // Composing while offline is allowed (7.3b) — only submission is disabled.
      await card.getByRole("button", { name: /主胜/ }).click();
      await card.getByLabel("投入积分").fill("800");
      await expect(card.getByRole("button", { name: "离线中，提交已禁用" })).toBeDisabled();
      await expect.poll(draftKeys).toHaveLength(1);
    } finally {
      await reconnectAndAwaitReload();
    }

    // First restore: prefilled, clearly announced, and NOT submitted.
    let card = await openSlip();
    await expect(card.getByText("已恢复离线草稿")).toBeVisible();
    await expect(card.getByText("系统不会自动提交")).toBeVisible();
    await expect(card.getByRole("button", { name: /主胜/ })).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByLabel("投入积分")).toHaveValue("800");
    await expect(card.getByText("判断已记录")).toBeHidden();

    // Second restore (reload again): still exactly one draft, still nothing submitted.
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
    card = await openSlip();
    await expect(card.getByText("已恢复离线草稿")).toBeVisible();
    await expect(card.getByText("判断已记录")).toBeHidden();
    expect(await draftKeys()).toHaveLength(1);

    // Only an explicit submit sends the ticket — and it clears the draft.
    await card.getByRole("button", { name: "确认最新倍率并提交" }).click();
    await expect(card.getByText("判断已记录")).toBeVisible({ timeout: 15_000 });
    await expect.poll(draftKeys).toHaveLength(0);
  });

  test("a draft whose odds moved while offline demands re-pick or discard", async ({ baseURL }) => {
    skipUnlessSw();
    // A fresh room: the previous test already holds a ticket on this fixture elsewhere.
    const room = await createRoomViaApi(page, baseURL, "E2E 过期草稿房");
    await page.goto(`/rooms/${room.roomId}`);
    await expect(page.locator("article").filter({ hasText: SEEDED_HOME_TEAM }).first()).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => {});

    await context.setOffline(true);
    try {
      await page.goto(`/rooms/${room.roomId}`);
      const card = await openSlip();
      await card.getByRole("button", { name: /平局/ }).click();
      await card.getByLabel("投入积分").fill("600");
      await expect.poll(draftKeys, { timeout: 10_000 }).toHaveLength(1);
      // Simulate the market moving while offline: the stored version no longer matches.
      await page.evaluate(() => {
        for (const key of Object.keys(window.localStorage)) {
          if (!key.startsWith("pulse-draft-v1:")) continue;
          const draft = JSON.parse(window.localStorage.getItem(key)!);
          draft.marketVersion = "e2e-odds-v0";
          draft.decimalOdds = "9.99";
          window.localStorage.setItem(key, JSON.stringify(draft));
        }
      });
    } finally {
      await reconnectAndAwaitReload();
    }

    const card = await openSlip();
    // The stale draft is announced and NOT prefilled — no selection, submit disabled.
    await expect(card.getByText("离线草稿需要处理")).toBeVisible();
    await expect(card.getByText(/离线期间积分倍率已变化/)).toBeVisible();
    await expect(card.getByRole("button", { name: /平局/ })).toHaveAttribute("aria-pressed", "false");
    await expect(card.getByRole("button", { name: "确认最新倍率并提交" })).toBeDisabled();

    // Explicit discard clears it; a fresh pick then submits normally.
    await card.getByRole("button", { name: "丢弃草稿" }).click();
    await expect(card.getByText("离线草稿需要处理")).toBeHidden();
    await expect.poll(draftKeys).toHaveLength(0);
    await card.getByRole("button", { name: /主胜/ }).click();
    await card.getByRole("button", { name: "确认最新倍率并提交" }).click();
    await expect(card.getByText("判断已记录")).toBeVisible({ timeout: 15_000 });
  });

  test("drafts never leak across accounts", async () => {
    skipUnlessSw();
    await context.setOffline(true);
    try {
      await page.goto(`/rooms/${roomId}`);
      const card = await openSlip();
      await card.getByRole("button", { name: /客胜/ }).click();
      await expect.poll(draftKeys, { timeout: 10_000 }).toHaveLength(1);
    } finally {
      await reconnectAndAwaitReload();
    }
    expect(await draftKeys(), "precondition: a draft survives reconnect until acted on").toHaveLength(1);

    // A different account logging in purges every draft before anything renders.
    const secondUser = uniqueUsername("resyb");
    await registerActor(page, secondUser);
    await loginActor(page, secondUser);
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(await draftKeys(), "another account must never see the previous user's drafts").toHaveLength(0);
  });
});
