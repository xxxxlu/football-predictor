import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createLoggedInActor, createRoomViaApi } from "./support/actors";

// Story 7.5 gate G1 — Journey 3: 封盘竞态 (market closes / odds change between view and submit).
//
// Requires the seeded football fixture from `pnpm db:seed:e2e` (E2E 联队 vs E2E 城队, SCHEDULED,
// kickoff in the future, OPEN 1X2 market with a verifiable odds snapshot). The two race outcomes are
// forced by intercepting POST …/tickets with the real 409 envelopes; the success case submits a REAL
// ticket end-to-end (odds version + snapshot verification included). A missing seed makes these
// tests FAIL loudly, not skip — a broken seed step must not read as green.

const SEEDED_HOME_TEAM = "E2E 联队";

test.describe.configure({ mode: "serial" });

test.describe("closing race: MARKET_CLOSED / ODDS_CHANGED / success", () => {
  let context: BrowserContext;
  let page: Page;
  let roomId = "";

  /** Open the room's matchday list, expand the seeded fixture's slip disclosure, return the card. */
  async function openSeededCard(): Promise<Locator> {
    await page.goto(`/rooms/${roomId}`);
    const card = page.locator("article").filter({ hasText: SEEDED_HOME_TEAM }).first();
    await expect(card, "seeded fixture rendered in the room matchday list (run `pnpm db:seed:e2e`)").toBeVisible();
    // The prediction slip sits behind a <details> disclosure on the card.
    await card.getByText("填写本场判断").click();
    await expect(card.getByRole("button", { name: "确认最新倍率并提交" })).toBeVisible();
    return card;
  }

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await createLoggedInActor(page, "race");
    const room = await createRoomViaApi(page, baseURL, "E2E 封盘竞态房");
    roomId = room.roomId;
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("shows a no-charge banner when the market closes before submit (MARKET_CLOSED)", async () => {
    await page.route("**/api/v1/rooms/*/tickets", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "MARKET_CLOSED", message: "比赛已经封盘" } }),
      });
    });
    try {
      const card = await openSeededCard();
      await card.getByRole("button", { name: /主胜/ }).click();
      await card.getByLabel("投入积分").fill("500");
      await card.getByRole("button", { name: "确认最新倍率并提交" }).click();

      await expect(card.getByText("未提交")).toBeVisible();
      await expect(card.getByText("比赛已经封盘，本次提交未扣分。")).toBeVisible();
    } finally {
      await page.unroute("**/api/v1/rooms/*/tickets");
    }
  });

  test("re-fetches and asks for reconfirmation when odds change (ODDS_CHANGED)", async () => {
    await page.route("**/api/v1/rooms/*/tickets", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "ODDS_CHANGED", message: "odds changed" } }),
      });
    }, { times: 1 });
    try {
      const card = await openSeededCard();
      await card.getByRole("button", { name: /主胜/ }).click();
      await card.getByLabel("投入积分").fill("500");
      await card.getByRole("button", { name: "确认最新倍率并提交" }).click();

      // The slip re-fetches the latest odds and asks the user to confirm again — no charge.
      await expect(card.getByText("积分倍率已经变化，已为你更新为最新倍率，请确认后再次提交。")).toBeVisible();
    } finally {
      await page.unroute("**/api/v1/rooms/*/tickets");
    }
  });

  test("records the prediction and returns a ticket number on success", async () => {
    // No interception: a genuinely OPEN fixture with a verifiable snapshot, real POST, real ledger freeze.
    const card = await openSeededCard();
    await card.getByRole("button", { name: /主胜/ }).click();
    await card.getByLabel("投入积分").fill("500");
    await card.getByRole("button", { name: "确认最新倍率并提交" }).click();

    await expect(card.getByText("判断已记录")).toBeVisible();
    await expect(card.getByText(/票号：/)).toBeVisible();
  });
});
