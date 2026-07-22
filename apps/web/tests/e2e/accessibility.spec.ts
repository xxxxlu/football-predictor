import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Story 7.5 gate G2 — automated accessibility scan (WCAG serious/critical gate).
//
// REAL spec: runs @axe-core/playwright against the anonymous-reachable pages and fails on any
// serious- or critical-impact violation. These routes render without a session or seed, so the scan
// is deterministic under both dev and the CI production server.
//
// SCOPE NOTE: this covers the anonymous surface only (auth + legal + landing). Authenticated surfaces
// (room, match detail, admin) require a session and are covered once Journeys 2–5 leave test.fixme —
// tracked as a documented gap in the Story 7.5 Dev Agent Record. axe is not a substitute for manual
// WCAG audit; it catches machine-detectable violations, which is what this gate asserts.

const ANONYMOUS_ROUTES = [
  { path: "/", name: "landing" },
  { path: "/login", name: "login" },
  { path: "/register", name: "register" },
  { path: "/recover", name: "recover" },
  { path: "/terms", name: "terms" },
];

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// Load a route and settle it for scanning. Use domcontentloaded (always resolves) then a BOUNDED wait
// for network idle: the animated landing page ("/") never fully idles, so an unbounded networkidle wait
// hits the 30s navigation timeout. Cap it and move on — the scan retry below covers the KickoffLoader
// navigation race regardless.
async function gotoForScan(page: import("@playwright/test").Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
}

// axe runs via page.evaluate; if the page navigates (e.g. the KickoffLoader splash → content swap)
// exactly while it runs, Playwright throws "Execution context was destroyed". That is a harness race,
// not an accessibility result, so retry after a short fixed settle (NOT networkidle, which never
// resolves on the animated landing page). Genuine violations still come back as results and fail the
// assertion in the test below.
async function analyzeAccessibility(page: import("@playwright/test").Page) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    } catch (error) {
      lastError = error;
      if (!String(error).includes("Execution context was destroyed")) throw error;
      await page.waitForTimeout(1000);
    }
  }
  throw lastError;
}

for (const route of ANONYMOUS_ROUTES) {
  test(`no serious or critical a11y violations: ${route.name} (${route.path})`, async ({ page }) => {
    // Load + bounded settle (see gotoForScan), then scan with a mid-navigation retry
    // (analyzeAccessibility). Deliberately NOT gating on a specific element so the scan never
    // false-passes on a page whose structure differs — a missing heading/landmark is a violation axe
    // should report, not something the harness should skip.
    await gotoForScan(page, route.path);

    const results = await analyzeAccessibility(page);

    const blocking = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );

    // Attach a readable summary so CI failures point straight at the rule + node.
    const summary = blocking.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target).slice(0, 5),
    }));

    expect(summary, `serious/critical a11y violations on ${route.path}`).toEqual([]);
  });
}
