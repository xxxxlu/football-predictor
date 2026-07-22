import { expect, test } from "@playwright/test";

// Story 7.5 gate G1 — Journey 2: 创建邀请 + 加入房间 (create invite → join private room).
//
// test.fixme: authenticated, multi-actor. Blocked from running here for two reasons, both recorded as
// documented gaps in the Story 7.5 Dev Agent Record:
//   1. Requires a persisted session. The CI e2e job runs the PRODUCTION `next start` server, which sets
//      `fp_session` with `Secure`; that cookie is dropped over http://127.0.0.1, so login does not
//      persist. To un-fixme this, run against `next dev` (NODE_ENV=development) via
//      PLAYWRIGHT_BASE_URL + reuseExistingServer, OR make the cookie's Secure flag configurable in the
//      test env (a product change, intentionally out of this story's scope).
//   2. Two browser contexts (host + invitee), each self-registering + logging in.
//
// The body below is the REAL intended flow (selectors verified against source), left as an executable
// specification. It is skipped, not faked.

test.fixme("host creates a private room and an invitee joins via the invite link", async ({ browser }) => {
  const password = "Passw0rd-e2e-01";

  // --- Host context: register, log in, create a PRIVATE room, read the invite URL. ---
  const hostContext = await browser.newContext();
  const host = await hostContext.newPage();

  const hostUser = `host${Date.now().toString(36)}`;
  await host.goto("/register");
  await host.getByLabel("用户名").fill(hostUser);
  await host.getByLabel("密码").fill(password);
  await host.locator('input[name="ageConfirmed"]').check();
  await host.locator('input[name="nonCashTermsAccepted"]').check();
  await host.getByRole("button", { name: "创建账户" }).click();
  await expect(host.getByText("账户已准备好")).toBeVisible();

  await host.goto("/login");
  await host.getByLabel("用户名").fill(hostUser);
  await host.getByLabel("密码").fill(password);
  await host.getByRole("button", { name: "登录" }).click();
  await expect(host).toHaveURL(/\/rooms/);

  await host.goto("/rooms");
  await host.getByLabel("房间名称").fill("E2E 私人房间");
  await host.getByRole("radio", { name: "私人" }).check();
  await host.locator('input[name="rulesAccepted"]').check();
  await host.getByRole("button", { name: "创建房间" }).click();
  await expect(host.getByText("房间已创建")).toBeVisible();
  const inviteUrl = await host.getByLabel("邀请链接").inputValue();
  expect(inviteUrl).toContain("/invite/");

  // --- Invitee context: register, log in, open the invite link, accept rules, join. ---
  const inviteeContext = await browser.newContext();
  const invitee = await inviteeContext.newPage();

  const inviteeUser = `guest${Date.now().toString(36)}`;
  await invitee.goto("/register");
  await invitee.getByLabel("用户名").fill(inviteeUser);
  await invitee.getByLabel("密码").fill(password);
  await invitee.locator('input[name="ageConfirmed"]').check();
  await invitee.locator('input[name="nonCashTermsAccepted"]').check();
  await invitee.getByRole("button", { name: "创建账户" }).click();
  await expect(invitee.getByText("账户已准备好")).toBeVisible();

  await invitee.goto("/login");
  await invitee.getByLabel("用户名").fill(inviteeUser);
  await invitee.getByLabel("密码").fill(password);
  await invitee.getByRole("button", { name: "登录" }).click();
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
