import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/** Shared axe harness (Story 7.5 gate G2 conventions).
 *
 *  gotoForScan: domcontentloaded always resolves; the follow-up networkidle wait
 *  is BOUNDED because animated pages (landing, PULSE line) never fully idle.
 *
 *  analyzeAccessibility: axe runs via page.evaluate; a navigation racing the scan
 *  (splash → content swap) throws "Execution context was destroyed" — a harness
 *  race, not an accessibility result, so retry after a fixed settle. Genuine
 *  violations still come back as results. */

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export async function gotoForScan(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
}

export async function analyzeAccessibility(page: Page) {
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

/** serious/critical violations condensed for a readable CI failure. */
export function blockingViolations(results: Awaited<ReturnType<typeof analyzeAccessibility>>) {
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target).slice(0, 5),
    }));
}
