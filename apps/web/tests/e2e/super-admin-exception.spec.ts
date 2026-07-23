import { expect, test } from "@playwright/test";
import { registerActor, uniqueUsername } from "./support/actors";

// Story 7.5 gate G1 — Journey 5: 超管异常处理 (super-admin: status board + disable/restore a user).
//
// The anonymous guard test needs nothing. The full flow needs the seeded super-admin credentials in
// SUPER_ADMIN_1_USERNAME / SUPER_ADMIN_1_PASSWORD (CI seeds them via `pnpm db:seed:super-admins` and
// exports the same values to this suite). Seeded admins carry must_change_password=true, so the first
// run walks the forced password change to a deterministic rotated password; re-runs against the same
// database log in with the rotated password directly. Without the env vars the flow skips with that
// reason — it is reported as skipped, never as a pass.

test("anonymous visitor to /admin/status is redirected to login", async ({ page }) => {
  await page.goto("/admin/status");
  await expect(page).toHaveURL(/\/login(\?|$)/, { timeout: 15_000 });
});

test("super admin disables and then restores a normal user", async ({ page }) => {
  const adminUser = process.env.SUPER_ADMIN_1_USERNAME?.trim().toLowerCase();
  const adminInitialPassword = process.env.SUPER_ADMIN_1_PASSWORD;
  test.skip(!adminUser || !adminInitialPassword, "SUPER_ADMIN_1_USERNAME / SUPER_ADMIN_1_PASSWORD not set — seed super-admins and export the credentials");
  if (!adminUser || !adminInitialPassword) return;
  // Deterministic rotation so the forced first-login password change stays re-runnable
  // against the same database (12–128 char policy still holds).
  const adminRotatedPassword = `${adminInitialPassword.slice(0, 100)}-e2e-rot`;

  // The disable/restore target is registered fresh through the real UI (no session is created).
  const targetUser = uniqueUsername("target");
  await registerActor(page, targetUser);

  // --- Admin login, absorbing the forced first-login password change. ---
  async function loginAs(password: string) {
    await page.goto("/login");
    // Hydration can remount the form after early fills (see support/actors.ts) — settle, then verify.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByLabel("用户名").fill(adminUser!);
    await page.getByLabel("密码").fill(password);
    for (const [label, value] of [["用户名", adminUser!], ["密码", password]] as const) {
      if ((await page.getByLabel(label).inputValue()) !== value) await page.getByLabel(label).fill(value);
    }
    await page.getByRole("button", { name: "登录" }).click();
    return Promise.race([
      page.waitForURL(/\/change-password/, { timeout: 10_000 }).then(() => "change-password" as const),
      page.waitForURL(/\/rooms/, { timeout: 10_000 }).then(() => "logged-in" as const),
      page.getByText("用户名或密码不正确。").waitFor({ timeout: 10_000 }).then(() => "rejected" as const),
    ]);
  }

  let adminPassword = adminInitialPassword;
  let outcome = await loginAs(adminInitialPassword);
  if (outcome === "rejected") {
    // A previous run already rotated the initial password.
    outcome = await loginAs(adminRotatedPassword);
    adminPassword = adminRotatedPassword;
  } else if (outcome === "change-password") {
    await page.getByLabel("当前初始密码").fill(adminInitialPassword);
    await page.getByLabel("新密码").fill(adminRotatedPassword);
    await page.getByRole("button", { name: "更新密码并继续" }).click();
    await page.waitForURL(/\/rooms/, { timeout: 10_000 });
    outcome = "logged-in";
    adminPassword = adminRotatedPassword;
  }
  expect(outcome, "super-admin session established").toBe("logged-in");

  // --- Status board renders (super-admin only). ---
  await page.goto("/admin/status");
  await expect(page.getByText("API-FOOTBALL 日额度")).toBeVisible();

  // --- Disable the target user (step-up reauth), then confirm the audited status change. ---
  await page.goto("/admin/users");
  const targetRow = page.locator("li").filter({ hasText: targetUser });
  await expect(targetRow).toBeVisible();
  await targetRow.getByRole("button", { name: "禁用账户" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`确认禁用 ${targetUser}`) })).toBeVisible();
  await page.getByLabel("当前管理员密码").fill(adminPassword);
  await page.getByRole("button", { name: "确认禁用" }).click();
  await expect(page.getByText("账户状态已更新")).toBeVisible();
  await expect(page.getByText(new RegExp(`${targetUser} 已禁用，审计编号`))).toBeVisible();

  // --- Restore it again. ---
  await targetRow.getByRole("button", { name: "恢复账户" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`确认恢复 ${targetUser}`) })).toBeVisible();
  await page.getByLabel("当前管理员密码").fill(adminPassword);
  await page.getByRole("button", { name: "确认恢复" }).click();
  await expect(page.getByText(new RegExp(`${targetUser} 已恢复，审计编号`))).toBeVisible();
});
