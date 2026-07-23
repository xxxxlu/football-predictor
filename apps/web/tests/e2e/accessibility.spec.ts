import { expect, test } from "@playwright/test";
import { analyzeAccessibility, blockingViolations, gotoForScan } from "./support/axe-scan";

// Story 7.5 gate G2 — automated accessibility scan (WCAG serious/critical gate).
//
// REAL spec: runs @axe-core/playwright against the anonymous-reachable pages and fails on any
// serious- or critical-impact violation. These routes render without a session or seed, so the scan
// is deterministic under both dev and the CI production server.
//
// SCOPE NOTE: this covers the anonymous surface only (auth + legal + landing). Authenticated
// football surfaces (room, match detail, admin) are covered once Journeys 2–5 leave test.fixme —
// tracked as a documented gap in the Story 7.5 Dev Agent Record. The authenticated F1 surfaces have
// their own scan in f1-accessibility.spec.ts (runs against `next dev`, self-skips under the CI
// Secure-cookie trap). axe is not a substitute for manual WCAG audit; it catches machine-detectable
// violations, which is what this gate asserts. Scan/retry mechanics live in ./support/axe-scan.ts.

const ANONYMOUS_ROUTES = [
  { path: "/", name: "landing" },
  { path: "/login", name: "login" },
  { path: "/register", name: "register" },
  { path: "/recover", name: "recover" },
  { path: "/terms", name: "terms" },
];

for (const route of ANONYMOUS_ROUTES) {
  test(`no serious or critical a11y violations: ${route.name} (${route.path})`, async ({ page }) => {
    // Load + bounded settle, then scan with a mid-navigation retry (see support/axe-scan.ts).
    // Deliberately NOT gating on a specific element so the scan never false-passes on a page whose
    // structure differs — a missing heading/landmark is a violation axe should report, not something
    // the harness should skip.
    await gotoForScan(page, route.path);

    const results = await analyzeAccessibility(page);

    expect(blockingViolations(results), `serious/critical a11y violations on ${route.path}`).toEqual([]);
  });
}
