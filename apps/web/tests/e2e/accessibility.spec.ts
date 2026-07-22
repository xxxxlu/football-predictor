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

for (const route of ANONYMOUS_ROUTES) {
  test(`no serious or critical a11y violations: ${route.name} (${route.path})`, async ({ page }) => {
    // goto defaults to waitUntil:"load"; these are server-rendered pages, so the DOM is fully present
    // for axe to scan. Deliberately NOT gating on a specific element (e.g. h1) so the scan never
    // false-fails on a page whose structure differs — a missing heading/landmark is itself something
    // axe reports as a violation rather than something the harness should crash on.
    await page.goto(route.path, { waitUntil: "load" });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

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
