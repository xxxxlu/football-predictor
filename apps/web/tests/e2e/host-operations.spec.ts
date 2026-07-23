import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createLoggedInActor, createRoomViaApi } from "./support/actors";

// Story 7.5 gate G1 — Journey 4: 房主运营 (host views privacy-preserving submission status).
//
// The owner registers + creates the room live; the submission board content comes from the seeded
// events (pnpm db:seed:e2e football fixture and/or pnpm db:seed:f1-2026 sessions — every room's board
// lists all events for its members). An empty board makes the owner test FAIL, not skip: a broken
// seed step must not read as green.

test.describe.configure({ mode: "serial" });

test.describe("host operations: submission status wall", () => {
  let ownerContext: BrowserContext;
  let owner: Page;
  let roomId = "";
  let inviteToken = "";

  test.beforeAll(async ({ browser, baseURL }) => {
    ownerContext = await browser.newContext();
    owner = await ownerContext.newPage();
    await createLoggedInActor(owner, "hostops");
    const room = await createRoomViaApi(owner, baseURL, "E2E 房主运营房");
    roomId = room.roomId;
    inviteToken = room.inviteToken;
    expect(inviteToken, "invite token for the member journey").not.toEqual("");
  });

  test.afterAll(async () => {
    await ownerContext?.close();
  });

  test("owner sees the privacy banner and per-fixture submission counts", async () => {
    await owner.goto(`/rooms/${roomId}/status`);

    // Owner view: privacy protection banner + at least one event with submission tallies.
    await expect(owner.getByText("隐私保护已开启")).toBeVisible();
    await expect(owner.getByText(/已提交\s*\d+\s*\/\s*\d+/).first()).toBeVisible();
    // The wall must never carry pre-lock picks — spot-check the page body.
    const body = (await owner.locator("body").innerText()).toLowerCase();
    expect(body).not.toMatch(/selection|stake(?:points)?|odds/);
  });

  test("a non-owner member is shown the owner-only forbidden state", async ({ browser }) => {
    const memberContext = await browser.newContext();
    const member = await memberContext.newPage();
    await createLoggedInActor(member, "hostmem");

    // Join the owner's room through the real invite flow so the actor is a genuine member.
    await member.goto(`/invite/${inviteToken}`);
    await expect(member.getByRole("heading", { name: /加入「E2E 房主运营房」/ })).toBeVisible();
    await member.getByRole("checkbox").check();
    await member.getByRole("button", { name: "确认规则并加入房间" }).click();
    await expect(member).toHaveURL(new RegExp(`/rooms/${roomId}`));

    await member.goto(`/rooms/${roomId}/status`);
    await expect(member.getByText("只有房主可以查看")).toBeVisible();

    await memberContext.close();
  });
});
