import { expect, test } from "@playwright/test";

// Story 7.5 gate G1 — Journey 1: 注册 + 一次性恢复码签发/轮换 (registration + one-time recovery code).
//
// This is a REAL, fully self-contained journey: single actor, no seed, no pre-existing DB rows, and
// — critically — it never depends on a persisted session cookie. Registration returns a one-time
// recovery code (HTTP 201) WITHOUT logging the user in, and account recovery only needs the username +
// recovery code. That means these specs pass under both `next dev` and the production `next start`
// server used by the CI e2e job (the `Secure`-cookie trap in NOTE below only affects authenticated
// journeys, which is why Journeys 2–5 are test.fixme).
//
// The only external dependency is a migrated Postgres, which the CI e2e job provisions. Local browser
// execution is environment-blocked in the dev sandbox (no app startup / browser download) — these run
// in CI and on the boss's machine.

// Lowercase+digits only: the safest subset of any username policy (3–32 chars). Unique per test.
function uniqueUsername(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// Passwords must be 12–128 chars.
const VALID_PASSWORD = "Passw0rd-e2e-01";
const ROTATED_PASSWORD = "Passw0rd-e2e-02";

async function submitRegistration(page: import("@playwright/test").Page, username: string, password: string): Promise<void> {
  await page.goto("/register");
  await expect(page.getByRole("button", { name: "创建账户" })).toBeVisible();
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.locator('input[name="ageConfirmed"]').check();
  await page.locator('input[name="nonCashTermsAccepted"]').check();
  await page.getByRole("button", { name: "创建账户" }).click();
}

test("registers a new account and reveals a one-time recovery code", async ({ page }) => {
  const username = uniqueUsername("e2ereg");
  await submitRegistration(page, username, VALID_PASSWORD);

  // Success renders the RecoveryReceipt, NOT a redirect.
  await expect(page.getByText("账户已准备好")).toBeVisible();
  await expect(page.getByText("恢复码只显示这一次，请立即保存。")).toBeVisible();

  // The recovery code is shown once, in a <code> element, formatted FP-XXXX-XXXX-...
  const code = (await page.locator("code").first().innerText()).trim();
  expect(code).toMatch(/^FP-/);

  // The copy + continue affordances exist (continue stays disabled until the code is copied — a
  // deliberate "save your code" guard; we assert presence rather than exercising the clipboard so the
  // core assertion stays independent of clipboard permissions).
  await expect(page.getByRole("button", { name: "复制恢复码" })).toBeVisible();
  await expect(page.getByRole("button", { name: "我已保存，去登录" })).toBeVisible();
});

test("rejects a duplicate username instead of issuing a second account", async ({ page }) => {
  const username = uniqueUsername("e2edup");

  // First registration succeeds and issues a recovery code.
  await submitRegistration(page, username, VALID_PASSWORD);
  await expect(page.getByText("账户已准备好")).toBeVisible();

  // Second registration with the same username is refused: the error region appears with the LOCALIZED
  // Chinese message for the server's USERNAME_UNAVAILABLE code, and the user stays on the form ("创建账户"
  // button still present) with NO recovery receipt issued. The error-code → message contract itself is
  // unit-tested in apps/web/src/features/auth/auth-error-messages.test.ts; here we prove it renders
  // end-to-end (guarding against the earlier i18n bug where the map used the wrong key and leaked the
  // English server message).
  await submitRegistration(page, username, VALID_PASSWORD);
  await expect(page.getByText("未能完成")).toBeVisible();
  await expect(page.getByText("这个用户名已被使用，请换一个。")).toBeVisible();
  await expect(page.getByRole("button", { name: "创建账户" })).toBeVisible();
});

test("recovers an account with its recovery code and rotates the code", async ({ page }) => {
  const username = uniqueUsername("e2erec");

  // Register and capture the first recovery code.
  await submitRegistration(page, username, VALID_PASSWORD);
  await expect(page.getByText("账户已准备好")).toBeVisible();
  const firstCode = (await page.locator("code").first().innerText()).trim();
  expect(firstCode).toMatch(/^FP-/);

  // Recover: username + recovery code + a new password. No session required.
  await page.goto("/recover");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("恢复码").fill(firstCode);
  await page.getByLabel("新密码").fill(ROTATED_PASSWORD);
  await page.getByRole("button", { name: "重置密码并轮换恢复码" }).click();

  // Recovery re-issues a NEW one-time code (the old one is rotated out).
  await expect(page.getByText("账户已准备好")).toBeVisible();
  const rotatedCode = (await page.locator("code").first().innerText()).trim();
  expect(rotatedCode).toMatch(/^FP-/);
  expect(rotatedCode).not.toEqual(firstCode);
});
