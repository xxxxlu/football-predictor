import { expect, test } from "@playwright/test";

// Regression guard for the first-visit self-reload:
//
// sw.js calls clients.claim() on activate, so on a first-ever visit the page gains a
// controller moments after load and `controllerchange` fires. The update handler used to
// reload unconditionally — wiping whatever the user had already typed (observed as the
// auth form losing its earliest-filled field). A controllerchange that merely claims a
// previously-uncontrolled page must NOT reload; only a real new-version takeover may.
//
// The service worker only registers on production builds (NODE_ENV=production), which is
// exactly what CI runs; against `next dev` there is no SW and the test passes trivially.

test("first visit does not self-reload after the service worker claims the page", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/register");

  // Plant a marker that any full reload would destroy, then give the SW time to
  // install, activate and claim (bounded so the dev server, with no SW, passes too).
  await page.evaluate(() => { (window as unknown as { __pulseNoReload?: boolean }).__pulseNoReload = true; });
  await page.evaluate(async () => {
    const ready = navigator.serviceWorker?.ready ?? Promise.resolve(null);
    await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 3_000))]);
  });
  await page.waitForTimeout(1_000);

  expect(
    await page.evaluate(() => (window as unknown as { __pulseNoReload?: boolean }).__pulseNoReload),
    "page reloaded itself after the service worker claimed it",
  ).toBe(true);

  await context.close();
});
