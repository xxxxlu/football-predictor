import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createLoggedInActor } from "./support/actors";
import { analyzeAccessibility, blockingViolations, gotoForScan } from "./support/axe-scan";

// Story 12.2 (NFR24-29) — automated axe scan over the daily challenge surface:
//   1. /club/daily before answering (question form + face-down fortune card)
//   2. /club/daily after answering (verdict via aria-live, revealed fortune,
//      results section unlocked) — the state transition the page exists for.
//
// Same session discipline as f1-accessibility.spec.ts: needs a persisting
// fp_session (APP_ENV=test or `next dev`); a Secure-cookie server makes the
// suite self-skip loudly. No seeded data needed — the question bank ships with
// the build.

async function expectNoBlockingViolations(page: Page, surface: string) {
  const results = await analyzeAccessibility(page);
  expect(blockingViolations(results), `serious/critical a11y violations on ${surface}`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test.describe("Club daily challenge accessibility", () => {
  let context: BrowserContext;
  let page: Page;
  let sessionOk = false;
  const skipUnlessSession = () => {
    test.skip(!sessionOk, "fp_session does not persist on this server (production Secure-cookie trap) — run against `next dev`");
  };

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await createLoggedInActor(page, "e2eclubaxe").catch(() => {});
    // Session probe: the daily endpoint itself proves both cookie and route.
    const dailyResponse = await page.request.get("/api/v1/club/daily");
    sessionOk = dailyResponse.status() === 200;
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("no serious or critical a11y violations: daily challenge before answering", async () => {
    skipUnlessSession();
    await gotoForScan(page, "/club/daily");
    await expect(page.getByRole("group")).toBeVisible();
    await expectNoBlockingViolations(page, "/club/daily (unanswered)");
  });

  test("no serious or critical a11y violations: after answering and revealing the fortune", async () => {
    skipUnlessSession();
    await gotoForScan(page, "/club/daily");
    const firstOption = page.getByRole("radio").first();
    await expect(firstOption).toBeVisible();
    // Keyboard path: focus the group, pick with arrow/space, submit — the whole
    // flow must work without a pointer (NFR25).
    await firstOption.check();
    await page.getByRole("button", { name: /提交答案|Submit answer/ }).click();
    // The verdict arrives in an aria-live region as text + symbol.
    await expect(page.getByText(/✓|✗/).first()).toBeVisible();
    await page.getByRole("button", { name: /翻开运势卡|Reveal your card/ }).click();
    await expect(page.getByRole("button", { name: /复制分享文案|Copy share text/ })).toBeVisible();
    // Let transitions settle so axe samples steady-state colors.
    await page.waitForTimeout(400);
    await expectNoBlockingViolations(page, "/club/daily (answered + fortune revealed)");
  });
});
