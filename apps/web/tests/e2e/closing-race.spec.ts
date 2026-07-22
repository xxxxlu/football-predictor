import { expect, test } from "@playwright/test";

// Story 7.5 gate G1 — Journey 3: 封盘竞态 (market closes / odds change between view and submit).
//
// test.fixme: highest-setup journey. Recorded as a documented gap in the Story 7.5 Dev Agent Record.
// Needs, beyond a session (see the Secure-cookie note in invite-join-room.spec.ts):
//   - A room the actor belongs to (ACTIVE status) containing at least one predictable fixture, i.e. a
//     supplier-sourced match with a verifiable odds snapshot and a kickoff still in the future.
//   - A way to force the race outcome. There is no UI to push a match to "about to close", so the
//     supported approaches are: (a) seed a fixture at a controlled close boundary via the worker /
//     direct DB insert, or (b) intercept POST /api/v1/rooms/<roomId>/tickets with page.route(...) and
//     return the 409 error envelope, asserting the UI reaction. (b) is the lighter scaffold and is
//     sketched below.
//
// The body captures the REAL assertions for the three server outcomes. Skipped, not faked.

test.fixme("shows a no-charge banner when the market closes before submit (MARKET_CLOSED)", async ({ page }) => {
  // Precondition: authenticated, inside an ACTIVE room with a predictable fixture rendered.
  // Intercept the ticket submission and force MARKET_CLOSED.
  await page.route("**/api/v1/rooms/*/tickets", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "MARKET_CLOSED", message: "比赛已经封盘" } }),
    });
  });

  await page.getByRole("button", { name: "主胜" }).click();
  await page.getByLabel("投入积分").fill("500");
  await page.getByRole("button", { name: "确认最新倍率并提交" }).click();

  await expect(page.getByText("未提交")).toBeVisible();
  await expect(page.getByText("比赛已经封盘，本次提交未扣分。")).toBeVisible();
});

test.fixme("re-fetches and asks for reconfirmation when odds change (ODDS_CHANGED)", async ({ page }) => {
  await page.route("**/api/v1/rooms/*/tickets", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "ODDS_CHANGED", message: "odds changed" } }),
    });
  });

  await page.getByRole("button", { name: "主胜" }).click();
  await page.getByLabel("投入积分").fill("500");
  await page.getByRole("button", { name: "确认最新倍率并提交" }).click();

  await expect(page.getByText("积分倍率已经变化，已为你更新为最新倍率，请确认后再次提交。")).toBeVisible();
});

test.fixme("records the prediction and returns a ticket number on success", async ({ page }) => {
  // No route interception: a genuinely OPEN fixture with a verifiable snapshot.
  await page.getByRole("button", { name: "主胜" }).click();
  await page.getByLabel("投入积分").fill("500");
  await page.getByRole("button", { name: "确认最新倍率并提交" }).click();

  await expect(page.getByText("判断已记录")).toBeVisible();
});
