import { expect, type Locator, type Page } from "@playwright/test";

/** Shared password for throwaway e2e actors (meets the 12–128 char policy). */
export const E2E_PASSWORD = "Passw0rd-e2e-journeys";

export function uniqueUsername(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Open an auth page and give React hydration time to land: on the fast production
 *  server, hydration can REMOUNT the form after Playwright already typed into the
 *  SSR DOM, silently wiping the earliest-filled field (observed as an empty 用户名
 *  while 密码 survived — the native `required` check then blocks the submit). */
async function gotoHydrated(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Fill fields, then verify every value survived hydration and refill what was wiped. */
async function fillStable(entries: Array<[Locator, string]>) {
  for (const [field, value] of entries) await field.fill(value);
  for (const [field, value] of entries) {
    if ((await field.inputValue()) !== value) await field.fill(value);
  }
}

/** Register a fresh account through the real UI. Does NOT create a session. */
export async function registerActor(page: Page, username: string, password: string = E2E_PASSWORD) {
  await gotoHydrated(page, "/register");
  await fillStable([
    [page.getByLabel("用户名"), username],
    [page.getByLabel("密码"), password],
  ]);
  await page.locator('input[name="ageConfirmed"]').check();
  await page.locator('input[name="nonCashTermsAccepted"]').check();
  await page.getByRole("button", { name: "创建账户" }).click();
  await expect(page.getByText("账户已准备好")).toBeVisible();
}

/** Log in through the real UI and wait for the post-login redirect (/rooms).
 *
 *  The privacy consent box is `required`, so leaving it unchecked does not produce a
 *  failed login — it produces no submit at all, because the browser's own validation
 *  stops the form. The wait below then times out inside whatever `beforeAll` called
 *  this, and every test in that describe is reported at 0ms as though it never ran.
 *  That is exactly how the privacy centre took out five e2e specs: the feature added
 *  a required gate to the login form and this helper was never taught about it. */
export async function loginActor(page: Page, username: string, password: string = E2E_PASSWORD) {
  await gotoHydrated(page, "/login");
  await fillStable([
    [page.getByLabel("用户名"), username],
    [page.getByLabel("密码"), password],
  ]);
  await page.locator('input[name="privacyConsent"]').check();
  await page.getByRole("button", { name: "登录" }).click();
  // Login success is a fetch + router.replace("/rooms"), not a navigation —
  // wait for the URL to actually leave /login before touching the session.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

/** Register + login a brand-new actor; returns the generated username. */
export async function createLoggedInActor(page: Page, prefix: string, password: string = E2E_PASSWORD) {
  const username = uniqueUsername(prefix);
  await registerActor(page, username, password);
  await loginActor(page, username, password);
  return username;
}

/** Create a room via the API using the page's session cookie; returns { roomId, inviteToken }. */
export async function createRoomViaApi(page: Page, baseURL: string | undefined, name: string, options?: { visibility?: "PRIVATE" | "PUBLIC"; tier?: "STANDARD" | "ADVANCED"; sport?: "FOOTBALL" | "FORMULA_1" }) {
  const response = await page.request.post("/api/v1/rooms", {
    headers: { origin: baseURL ?? "http://127.0.0.1:3001" },
    // A room predicts exactly one sport, so an F1 journey must ask for an F1 room —
    // the server refuses an F1 ticket in a football room (ROOM_SPORT_MISMATCH).
    data: { name, visibility: options?.visibility ?? "PRIVATE", tier: options?.tier ?? "STANDARD", sport: options?.sport ?? "FOOTBALL", rulesAccepted: true },
  });
  expect(response.status(), "room creation").toBe(201);
  const body = (await response.json()) as { data?: { id?: string; inviteToken?: string } };
  const roomId = body.data?.id ?? "";
  expect(roomId, "room id from creation response").not.toEqual("");
  return { roomId, inviteToken: body.data?.inviteToken ?? "" };
}
