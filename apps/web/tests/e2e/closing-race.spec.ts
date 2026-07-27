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
  let origin: string | undefined;

  /** Open the room's matchday list and expand the seeded fixture's slip disclosure. */
  async function openCard(): Promise<Locator> {
    await page.goto(`/rooms/${roomId}`);
    const card = page.locator("article").filter({ hasText: SEEDED_HOME_TEAM }).first();
    await expect(card, "seeded fixture rendered in the room matchday list (run `pnpm db:seed:e2e`)").toBeVisible();
    // The prediction slip sits behind a <details> disclosure on the card.
    await card.getByText("填写本场判断").click();
    return card;
  }

  /** Same, asserting the slip is still open for business (no ticket on this market yet). */
  async function openSeededCard(): Promise<Locator> {
    const card = await openCard();
    await expect(card.getByRole("button", { name: "确认最新倍率并提交" })).toBeVisible();
    return card;
  }

  test.beforeAll(async ({ browser, baseURL }) => {
    origin = baseURL;
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

    // 一人一注 takes effect immediately: the slip switches to waiting-for-settlement.
    await expect(card.getByText("胜平负已提交判断")).toBeVisible();
    await expect(card.getByRole("button", { name: "确认最新倍率并提交" })).toHaveCount(0);
  });

  // 一人一注 (football): the ticket above is this test's precondition — serial mode.
  test("keeps the market closed to a second ticket after a reload, and the server agrees", async () => {
    const card = await openCard();
    await expect(card.getByText("胜平负已提交判断"), "placed state restored from tickets/mine").toBeVisible();
    await expect(card.getByRole("button", { name: /主胜/ })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "确认最新倍率并提交" })).toHaveCount(0);

    // The UI is never the authorization boundary: post the same market straight to the API.
    type ApiMatch = { id: string; homeTeam?: string | { name?: string }; market?: { id?: string } };
    const list = await (await page.request.get(`/api/v1/matches?roomId=${roomId}`)).json() as { data?: ApiMatch[] };
    const home = (match: ApiMatch) => typeof match.homeTeam === "string" ? match.homeTeam : match.homeTeam?.name;
    const seeded = (list.data ?? []).find((match) => home(match) === SEEDED_HOME_TEAM);
    expect(seeded?.market?.id, "seeded fixture exposes its 1X2 market id").toBeTruthy();

    // 一人一注 is checked before the odds comparison, so a deliberately stale version
    // must still come back as MARKET_TICKET_EXISTS rather than ODDS_CHANGED.
    const response = await page.request.post(`/api/v1/rooms/${roomId}/tickets`, {
      headers: { origin: origin!, "Idempotency-Key": `e2e-second-${Date.now()}` },
      data: { matchId: seeded!.id, marketId: seeded!.market!.id!, marketVersion: "e2e-stale-version", selection: "AWAY", stakePoints: "500", acceptedOdds: "1.01" },
    });
    expect(response.status()).toBe(409);
    expect(((await response.json()) as { error?: { code?: string } }).error?.code).toBe("MARKET_TICKET_EXISTS");
  });
});
