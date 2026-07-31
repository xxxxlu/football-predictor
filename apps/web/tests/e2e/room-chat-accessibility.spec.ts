import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createLoggedInActor, createRoomViaApi } from "./support/actors";
import { analyzeAccessibility, blockingViolations, gotoForScan } from "./support/axe-scan";

// Story 12.3 (NFR24-29) — automated axe scan over the room public chat:
//   1. the room page with an empty chat (input + hint + empty state)
//   2. after sending a message through the composer (aria-live list populated,
//      per-message action buttons rendered — the owner sees 举报/置顶/禁言)
//
// Same session discipline as club-daily-accessibility.spec.ts: needs a
// persisting fp_session (APP_ENV=test or `next dev`); a Secure-cookie server
// makes the suite self-skip loudly. Fully self-contained — the actor registers
// and creates its own room, no seed needed.

async function expectNoBlockingViolations(page: Page, surface: string) {
  const results = await analyzeAccessibility(page);
  expect(blockingViolations(results), `serious/critical a11y violations on ${surface}`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test.describe("Room chat accessibility", () => {
  let context: BrowserContext;
  let page: Page;
  let roomId = "";
  let sessionOk = false;
  const skipUnlessSession = () => {
    test.skip(!sessionOk, "fp_session does not persist on this server (production Secure-cookie trap) — run against `next dev`");
  };

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await createLoggedInActor(page, "e2echataxe").catch(() => {});
    const session = await page.request.get("/api/v1/rooms");
    sessionOk = session.status() === 200;
    if (sessionOk) ({ roomId } = await createRoomViaApi(page, baseURL, "公屏无障碍扫描房"));
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("no serious or critical a11y violations: empty chat with composer", async () => {
    skipUnlessSession();
    await gotoForScan(page, `/rooms/${roomId}`);
    await expect(page.getByRole("heading", { name: "房间公屏" })).toBeVisible();
    await expect(page.getByLabel("发送消息")).toBeVisible();
    await expectNoBlockingViolations(page, "room chat (empty)");
  });

  test("no serious or critical a11y violations: after sending via the keyboard-reachable composer", async () => {
    skipUnlessSession();
    await gotoForScan(page, `/rooms/${roomId}`);
    const composer = page.getByLabel("发送消息");
    await composer.fill("公屏无障碍扫描消息");
    // Submit via keyboard: the whole flow must work without a pointer (NFR25).
    await composer.press("Enter");
    await expect(page.getByText("公屏无障碍扫描消息")).toBeVisible();
    // Owner-side per-message actions are focusable controls, not hover-only.
    await expect(page.getByRole("button", { name: "举报", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "置顶", exact: true }).first()).toBeVisible();
    await page.waitForTimeout(400);
    await expectNoBlockingViolations(page, "room chat (message sent, owner actions)");
  });
});
