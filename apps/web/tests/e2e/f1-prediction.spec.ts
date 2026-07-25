import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { createLoggedInActor, createRoomViaApi } from "./support/actors";

// F1 prediction rules end to end. The F1 markets shipped with unit coverage and an
// axe scan only, so nothing exercised the rules a player actually meets:
//   1. 领奖台之争 prices an arbitrary P1→P2→P3 combination from per-driver base odds
//   2. 一人一注 — a second ticket on the same market is refused (409) and the slip
//      switches to the waiting panel
//   3. that placed state survives a reload (restored from tickets/mine)
//   4. a `DRV:` base outcome is a pricing input, never a bettable selection (503)
//   5. retired markets (PODIUM, H2H) are not offered on any seeded session
//
// Needs a persisting session (the cookie's Secure flag keys on APP_ENV) and seeded
// F1 weekends (`pnpm db:seed:f1-2026`, CI seeds them). Both are self-skips with the
// reason in the report — skipped, never a false pass.

type MarketView = { id: string; kind: string; version: string; outcomes: Array<{ selection: string; decimalOdds: string }> };
type DetailView = { session: { id: string }; drivers: Array<{ code: string }>; markets: MarketView[] };

async function sessionDetail(request: APIRequestContext, sessionId: string): Promise<DetailView | null> {
  const response = await request.get(`/api/v1/f1/sessions/${encodeURIComponent(sessionId)}`);
  if (response.status() !== 200) return null;
  return ((await response.json()) as { data?: DetailView }).data ?? null;
}

test.describe.configure({ mode: "serial" });

test.describe("F1 prediction rules", () => {
  let context: BrowserContext;
  let page: Page;
  let sessionOk = false;
  let roomId = "";
  let sessionId = "";
  let podiumMarket: MarketView | undefined;
  let allSessionIds: string[] = [];
  let origin = "http://127.0.0.1:3001";

  const skipUnlessSession = () => {
    test.skip(!sessionOk, "fp_session does not persist on this server (production Secure-cookie trap) — run against `next dev`");
  };
  const skipUnlessPodium = () => {
    skipUnlessSession();
    test.skip(!podiumMarket, "no predictable session offers 领奖台之争 — seed with `pnpm db:seed:f1-2026`");
  };

  test.beforeAll(async ({ browser, baseURL }) => {
    origin = baseURL ?? origin;
    context = await browser.newContext();
    page = await context.newPage();
    await createLoggedInActor(page, "e2ef1rules").catch(() => {});

    const weekendsResponse = await page.request.get("/api/v1/f1/weekends");
    sessionOk = weekendsResponse.status() === 200;
    if (!sessionOk) return;

    const weekends = ((await weekendsResponse.json()) as { data?: Array<{ sessions?: Array<{ id: string; state: string; startsAt: string }> }> }).data ?? [];
    allSessionIds = weekends.flatMap((weekend) => (weekend.sessions ?? []).map((session) => session.id));

    // Find a still-predictable session that offers the combination market: a
    // qualifying session only offers 杆位, so picking "the first upcoming one"
    // would quietly test nothing.
    const now = Date.now();
    for (const weekend of weekends) {
      for (const session of weekend.sessions ?? []) {
        if (session.state !== "UPCOMING" || new Date(session.startsAt).getTime() <= now) continue;
        const detail = await sessionDetail(page.request, session.id);
        const market = detail?.markets.find((candidate) => candidate.kind === "EXACT_PODIUM");
        if (market) {
          sessionId = session.id;
          podiumMarket = market;
          break;
        }
      }
      if (podiumMarket) break;
    }
    if (!podiumMarket) return;

    ({ roomId } = await createRoomViaApi(page, origin, "F1 玩法回归房", { sport: "FORMULA_1" }));
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("领奖台之争 prices a freely chosen P1/P2/P3 combination and accepts the ticket", async () => {
    skipUnlessPodium();
    await page.goto(`/matches/f1/${sessionId}?roomId=${roomId}`);
    const slip = page.getByRole("form", { name: "F1 判断凭证" });
    await expect(slip).toBeVisible();
    await slip.getByRole("tab", { name: "领奖台之争" }).click();

    // The market carries per-driver base odds only — 9,240 ordered combinations are
    // never enumerated — so the price for a chosen trio must be derived client-side.
    const drivers = slip.getByRole("group", { name: "全部车手" }).getByRole("button");
    await expect(drivers.first()).toBeVisible();
    for (const index of [0, 1, 2]) await drivers.nth(index).click();
    // Assert the slot summary exists before asserting it holds no placeholder —
    // a wrong locator would otherwise report "no 待选 left" against nothing at all.
    const slots = slip.getByRole("group", { name: "已选前三" });
    await expect(slots).toBeVisible();
    await expect(slots.getByText("待选")).toHaveCount(0);
    await expect(slip.getByText(/已锁定 [0-9.]+x/)).toBeVisible();

    await slip.getByRole("button", { name: "500" }).click();
    await slip.getByRole("button", { name: "确认最新倍率并提交" }).click();
    await expect(slip.getByText("判断已记录")).toBeVisible();
  });

  test("一人一注: the same market refuses a second ticket and the slip waits for settlement", async () => {
    skipUnlessPodium();
    // The slip switched to the waiting panel and the market tab is marked as placed.
    const slip = page.getByRole("form", { name: "F1 判断凭证" });
    await expect(slip.getByText("领奖台之争已提交判断")).toBeVisible();
    await expect(slip.getByRole("tab", { name: /领奖台之争 ✓已投/ })).toBeVisible();
    await expect(slip.getByRole("button", { name: "确认最新倍率并提交" })).toHaveCount(0);

    // Hiding the form is never the boundary: the server must refuse on its own.
    const outcome = podiumMarket!.outcomes.find((candidate) => candidate.selection.startsWith("POD3:"));
    const drivers = (await sessionDetail(page.request, sessionId))?.drivers ?? [];
    const selection = outcome?.selection ?? `POD3:${drivers[0]?.code}-${drivers[1]?.code}-${drivers[2]?.code}`;
    const response = await page.request.post(`/api/v1/rooms/${roomId}/tickets`, {
      headers: { origin, "Idempotency-Key": `e2e-f1-second-${Date.now()}` },
      data: { matchId: `f1:${sessionId}`, marketId: podiumMarket!.id, marketVersion: podiumMarket!.version, selection, stakePoints: "500", acceptedOdds: outcome?.decimalOdds ?? "10.00" },
    });
    expect(response.status(), "second ticket on an already-predicted market").toBe(409);
    expect(((await response.json()) as { error?: { code?: string } }).error?.code).toBe("MARKET_TICKET_EXISTS");
  });

  test("the placed state is restored from the server after a reload", async () => {
    skipUnlessPodium();
    await page.goto(`/matches/f1/${sessionId}?roomId=${roomId}`);
    const slip = page.getByRole("form", { name: "F1 判断凭证" });
    await expect(slip).toBeVisible();
    await slip.getByRole("tab", { name: "领奖台之争" }).click();
    await expect(slip.getByText("领奖台之争已提交判断")).toBeVisible();
  });

  test("a DRV base outcome is a pricing input, not a bettable selection", async () => {
    skipUnlessPodium();
    const base = podiumMarket!.outcomes.find((candidate) => candidate.selection.startsWith("DRV:"));
    test.skip(!base, "this market snapshot enumerates combinations instead of per-driver base odds");
    const response = await page.request.post(`/api/v1/rooms/${roomId}/tickets`, {
      headers: { origin, "Idempotency-Key": `e2e-f1-drv-${Date.now()}` },
      data: { matchId: `f1:${sessionId}`, marketId: podiumMarket!.id, marketVersion: podiumMarket!.version, selection: base!.selection, stakePoints: "500", acceptedOdds: base!.decimalOdds },
    });
    expect(response.status(), `staking ${base!.selection} directly`).toBe(503);
    expect(((await response.json()) as { error?: { code?: string } }).error?.code).toBe("DATA_UNAVAILABLE");
  });

  test("retired markets are not offered on any seeded session", async () => {
    skipUnlessSession();
    test.skip(allSessionIds.length === 0, "no F1 sessions in the DB — seed with `pnpm db:seed:f1-2026`");
    const offered = new Set<string>();
    for (const id of allSessionIds) {
      const detail = await sessionDetail(page.request, id);
      for (const market of detail?.markets ?? []) offered.add(market.kind);
    }
    // PODIUM folded into 领奖台之争 and H2H was withdrawn; existing tickets still
    // settle, but neither may be offered for a new prediction.
    expect([...offered].sort()).not.toContain("PODIUM");
    expect([...offered].sort()).not.toContain("H2H");
    expect(offered.size, "seeded sessions must still offer some market").toBeGreaterThan(0);
  });
});
