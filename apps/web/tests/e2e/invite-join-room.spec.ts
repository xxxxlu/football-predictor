import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, registerActor, loginActor, uniqueUsername } from "./support/actors";

// Story 7.5 gate G1 — Journey 2: 创建邀请 + 加入房间 (create invite → join private room).
//
// Fully self-contained: both actors register through the real UI, so this journey needs no seed.
// It runs against any server whose fp_session cookie survives plain http — the CI e2e job qualifies
// since the Secure flag moved to APP_ENV (APP_ENV=test there).

test("host creates a private room and an invitee joins via the invite link", async ({ browser }) => {
  // --- Host context: register, log in, create a PRIVATE room, read the invite URL. ---
  const hostContext = await browser.newContext();
  const host = await hostContext.newPage();

  const hostUser = uniqueUsername("host");
  await registerActor(host, hostUser);
  await loginActor(host, hostUser);
  await expect(host).toHaveURL(/\/rooms/);

  await host.goto("/rooms");
  await host.waitForLoadState("networkidle").catch(() => {});
  await host.getByLabel("房间名称").fill("E2E 私人房间");
  if ((await host.getByLabel("房间名称").inputValue()) !== "E2E 私人房间") await host.getByLabel("房间名称").fill("E2E 私人房间");
  await host.getByRole("radio", { name: /私人/ }).check();
  await host.locator('input[name="rulesAccepted"]').check();
  await host.getByRole("button", { name: "创建房间" }).click();
  await expect(host.getByText("房间已创建")).toBeVisible();
  const inviteUrl = await host.getByLabel("邀请链接").inputValue();
  expect(inviteUrl).toContain("/invite/");

  // --- Invitee context: register, log in, open the invite link, accept rules, join. ---
  const inviteeContext = await browser.newContext();
  const invitee = await inviteeContext.newPage();

  const inviteeUser = uniqueUsername("guest");
  await registerActor(invitee, inviteeUser, E2E_PASSWORD);
  await loginActor(invitee, inviteeUser, E2E_PASSWORD);
  await expect(invitee).toHaveURL(/\/rooms/);

  await invitee.goto(inviteUrl);
  await expect(invitee.getByRole("heading", { name: /加入「E2E 私人房间」/ })).toBeVisible();
  await invitee.getByRole("checkbox").check();
  await invitee.getByRole("button", { name: "确认规则并加入房间" }).click();

  // Landed inside the room.
  await expect(invitee).toHaveURL(/\/rooms\//);
  await expect(invitee.getByRole("heading", { name: "房间成员" })).toBeVisible();

  await hostContext.close();
  await inviteeContext.close();
});
