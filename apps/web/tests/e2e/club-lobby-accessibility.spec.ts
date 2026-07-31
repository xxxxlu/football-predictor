import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createLoggedInActor } from "./support/actors";
import { analyzeAccessibility, blockingViolations, gotoForScan } from "./support/axe-scan";

// Story 12.4 (NFR24-29) — automated axe scan over the PULSE CLUB lobby:
//   1. the lobby with the rules-confirmation card (the pre-confirmation state)
//   2. after confirming the rules and sending through the keyboard-reachable
//      composer (aria-live channel list populated, report action rendered)
//
// Same session discipline as room-chat-accessibility.spec.ts: needs a
// persisting fp_session (APP_ENV=test or `next dev`). Fully self-contained —
// the actor registers itself, no seed needed.

async function expectNoBlockingViolations(page: Page, surface: string) {
  const results = await analyzeAccessibility(page);
  expect(blockingViolations(results), `serious/critical a11y violations on ${surface}`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test.describe("Club lobby accessibility", () => {
  let context: BrowserContext;
  let page: Page;
  let sessionOk = false;
  const skipUnlessSession = () => {
    test.skip(!sessionOk, "fp_session does not persist on this server (production Secure-cookie trap) — run against `next dev`");
  };

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await createLoggedInActor(page, "e2elobbyaxe").catch(() => {});
    const session = await page.request.get("/api/v1/club/rules-acceptance");
    sessionOk = session.status() === 200;
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("no serious or critical a11y violations: lobby sections with the rules card", async () => {
    skipUnlessSession();
    await gotoForScan(page, "/club");
    await expect(page.getByRole("heading", { name: "在场名录" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "好友动态" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "公共频道" })).toBeVisible();
    // Pre-confirmation state: the composer is replaced by the rules card (AC2).
    await expect(page.getByRole("button", { name: "我已阅读并确认社区规则" })).toBeVisible();
    await expectNoBlockingViolations(page, "club lobby (rules card)");
  });

  test("no serious or critical a11y violations: after confirming and sending via the keyboard", async () => {
    skipUnlessSession();
    await gotoForScan(page, "/club");
    await page.getByRole("button", { name: "我已阅读并确认社区规则" }).click();
    const composer = page.getByLabel("发送消息");
    await expect(composer).toBeVisible();
    // Submit via keyboard: the whole flow must work without a pointer (NFR25).
    await composer.fill("大厅无障碍扫描消息");
    await composer.press("Enter");
    await expect(page.getByText("大厅无障碍扫描消息")).toBeVisible();
    // The per-message report action is a focusable control, not hover-only.
    await expect(page.getByRole("button", { name: "举报", exact: true }).first()).toBeVisible();
    await page.waitForTimeout(400);
    await expectNoBlockingViolations(page, "club lobby (channel populated)");
  });
});
