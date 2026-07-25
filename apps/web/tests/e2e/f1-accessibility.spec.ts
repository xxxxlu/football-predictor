import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createLoggedInActor } from "./support/actors";
import { analyzeAccessibility, blockingViolations, gotoForScan } from "./support/axe-scan";

// P1-3 — automated axe scan over the authenticated F1 surfaces:
//   1. /matches/f1 (race weekend list)
//   2. /matches/f1/<sessionId> (session detail, browse mode)
//   3. /matches/f1/<sessionId>?roomId=… with the F1 Prediction Slip engaged
//   4. /rooms/<roomId> after an F1 ticket exists (成员投入记录 with an F1 row)
//
// These journeys need a persisting session. The session cookie's Secure flag
// keys on APP_ENV, so they run REAL against `next dev` and against the CI
// production build (APP_ENV=test); a server that still drops the cookie makes
// the suite self-skip loudly, with the reason in the report — skipped, never a
// false pass. Detail/slip/room scans additionally need seeded F1 weekends
// (`pnpm db:seed:f1-2026`, CI seeds them) and skip with that instruction when
// the DB is bare.

async function expectNoBlockingViolations(page: Page, surface: string) {
  const results = await analyzeAccessibility(page);
  expect(blockingViolations(results), `serious/critical a11y violations on ${surface}`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test.describe("F1 surfaces accessibility", () => {
  let context: BrowserContext;
  let page: Page;
  let sessionOk = false;
  let roomId = "";
  let predictableSessionId = "";
  const skipUnlessSession = () => {
    test.skip(!sessionOk, "fp_session does not persist on this server (production Secure-cookie trap) — run against `next dev`");
  };
  const skipUnlessSeeded = () => {
    skipUnlessSession();
    test.skip(!predictableSessionId, "no predictable F1 session in the DB — seed with `pnpm db:seed:f1-2026`");
  };

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext();
    page = await context.newPage();

    // Register a fresh actor through the real UI, then log in (hydration-stabilized
    // shared helper — also waits out the post-login router.replace so the session
    // probe below cannot race the login fetch).
    await createLoggedInActor(page, "e2ef1axe").catch(() => {});

    // Session probe: 200 proves the cookie persisted; 401 is the Secure-cookie trap.
    const weekendsResponse = await page.request.get("/api/v1/f1/weekends");
    sessionOk = weekendsResponse.status() === 200;
    if (!sessionOk) return;

    // Pick a session that is still predictable so the slip renders interactive.
    const weekends = ((await weekendsResponse.json()) as { data?: Array<{ sessions?: Array<{ id: string; state: string; startsAt: string }> }> }).data ?? [];
    const now = Date.now();
    for (const weekend of weekends) {
      for (const session of weekend.sessions ?? []) {
        if (session.state === "UPCOMING" && new Date(session.startsAt).getTime() > now) {
          predictableSessionId = session.id;
          break;
        }
      }
      if (predictableSessionId) break;
    }
    if (!predictableSessionId) return;

    // A fresh room owned by the actor gives the slip a points account to freeze
    // against and gives the room page an F1-capable investment wall.
    const createRoom = await page.request.post("/api/v1/rooms", {
      headers: { origin: baseURL ?? "http://127.0.0.1:3001" },
      data: { name: "F1 无障碍扫描房", visibility: "PRIVATE", tier: "STANDARD", sport: "FORMULA_1", rulesAccepted: true },
    });
    expect(createRoom.status(), "room creation for the a11y fixture").toBe(201);
    roomId = ((await createRoom.json()) as { data?: { id?: string } }).data?.id ?? "";
    expect(roomId, "room id from creation response").not.toEqual("");
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("no serious or critical a11y violations: F1 race weekend list (/matches/f1)", async () => {
    skipUnlessSession();
    await gotoForScan(page, "/matches/f1");
    await expectNoBlockingViolations(page, "/matches/f1");
  });

  test("no serious or critical a11y violations: F1 session detail (browse mode)", async () => {
    skipUnlessSeeded();
    await gotoForScan(page, `/matches/f1/${predictableSessionId}`);
    await expect(page.getByRole("heading", { name: "车手榜" })).toBeVisible();
    await expectNoBlockingViolations(page, "F1 session detail (browse)");
  });

  test("no serious or critical a11y violations: F1 Prediction Slip engaged in a room", async () => {
    skipUnlessSeeded();
    await gotoForScan(page, `/matches/f1/${predictableSessionId}?roomId=${roomId}`);
    // Scan only once the slip actually rendered — scanning the loading panel
    // would false-pass the surface this test exists to cover.
    const slip = page.getByRole("form", { name: "F1 判断凭证" });
    await expect(slip).toBeVisible();
    // Engage the slip so pressed/selected states are part of the scanned tree.
    await slip.getByRole("button").filter({ hasText: /^[A-Z]{3}/ }).first().click();
    await slip.getByRole("button", { name: "500" }).click();
    // Let the button color transition finish: axe samples computed colors, and a
    // scan fired mid-transition measures a transient blend, not the steady state.
    await page.waitForTimeout(400);
    await expectNoBlockingViolations(page, "F1 prediction slip");
  });

  test("no serious or critical a11y violations: room investment wall with an F1 ticket", async () => {
    skipUnlessSeeded();
    // Submit a real ticket through the slip so 成员投入记录 renders an F1 row.
    await gotoForScan(page, `/matches/f1/${predictableSessionId}?roomId=${roomId}`);
    const slip = page.getByRole("form", { name: "F1 判断凭证" });
    await expect(slip).toBeVisible();
    await slip.getByRole("button").filter({ hasText: /^[A-Z]{3}/ }).first().click();
    await slip.getByRole("button", { name: "500" }).click();
    await slip.getByRole("button", { name: "确认最新倍率并提交" }).click();
    await expect(page.getByText("判断已记录")).toBeVisible();

    await gotoForScan(page, `/rooms/${roomId}`);
    await expect(page.getByRole("heading", { name: "成员投入记录" })).toBeVisible();
    // The F1 ticket row must be on the wall (weekend · session title), otherwise
    // this scan silently degrades to the football-only surface.
    await expect(page.getByText(/GRAND PRIX · /).first()).toBeVisible();
    await expectNoBlockingViolations(page, "room investment wall with an F1 ticket");
  });
});
