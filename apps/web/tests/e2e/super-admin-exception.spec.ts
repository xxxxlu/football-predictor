import { expect, test } from "@playwright/test";

// Story 7.5 gate G1 — Journey 5: 超管异常处理 (super-admin: status board + disable/restore a user).
//
// This file mixes ONE real guard test (anonymous access is denied — no seed, no session, runs in CI)
// with the full super-admin happy path as test.fixme.

// REAL: the admin surface is gated. An anonymous visitor is bounced to /login by the client-side
// SessionGuard (there is no middleware). Verifies the access boundary without any seed or session.
test("anonymous visitor to /admin/status is redirected to login", async ({ page }) => {
  await page.goto("/admin/status");
  await expect(page).toHaveURL(/\/login(\?|$)/, { timeout: 15_000 });
});

// test.fixme: full super-admin exception flow. Recorded as a documented gap in the Story 7.5 Dev Agent
// Record. Requires, beyond a session (see the Secure-cookie note in invite-join-room.spec.ts):
//   - A seeded super admin: `pnpm db:seed:super-admins` (SUPER_ADMIN_* env already present in repo .env;
//     the script reads process.env directly, so run with `node --env-file=.env ...` or exported vars).
//     Seeded admins have must_change_password=true → first login redirects to /change-password.
//   - A second normal user as the disable/restore target.
//   - Admin mutations require step-up reauth (POST /api/v1/auth/reauthenticate sets fp_reauth), i.e. the
//     admin password is re-entered in the confirm panel.
//
// The body captures the REAL flow. Skipped, not faked.
test.fixme("super admin disables and then restores a normal user", async ({ page }) => {
  const adminUser = "REPLACE_WITH_SEEDED_SUPER_ADMIN";
  const adminInitialPassword = "REPLACE_WITH_SEEDED_PASSWORD";
  const adminNewPassword = "Passw0rd-e2e-admin-01";
  const targetUser = "REPLACE_WITH_SEEDED_TARGET_USER";

  // First login forces a password change.
  await page.goto("/login");
  await page.getByLabel("用户名").fill(adminUser);
  await page.getByLabel("密码").fill(adminInitialPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/change-password/);
  await page.getByLabel("当前初始密码").fill(adminInitialPassword);
  await page.getByLabel("新密码").fill(adminNewPassword);
  await page.getByRole("button", { name: "更新密码并继续" }).click();

  // Status board renders (super-admin only).
  await page.goto("/admin/status");
  await expect(page.getByText("API-FOOTBALL 日额度")).toBeVisible();

  // Disable the target user (with step-up reauth), then confirm the audited status change.
  await page.goto("/admin/users");
  const targetRow = page.getByRole("row", { name: new RegExp(targetUser) });
  await targetRow.getByRole("button", { name: "禁用账户" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`确认禁用 ${targetUser}`) })).toBeVisible();
  await page.getByLabel("当前管理员密码").fill(adminNewPassword);
  await page.getByRole("button", { name: "确认禁用" }).click();
  await expect(page.getByText("账户状态已更新")).toBeVisible();
  await expect(page.getByText(new RegExp(`${targetUser} 已禁用，审计编号`))).toBeVisible();

  // Restore it again.
  await targetRow.getByRole("button", { name: "恢复账户" }).click();
  await page.getByLabel("当前管理员密码").fill(adminNewPassword);
  await page.getByRole("button", { name: "确认恢复" }).click();
  await expect(page.getByText("账户状态已更新")).toBeVisible();
});
