/** Rasterizes the brand SVG marks into the PNG sizes that installers require.
 *
 *  iOS ignores an SVG `apple-touch-icon` and falls back to a screenshot of the
 *  page, and several Android launchers skip an SVG-only manifest icon set, so the
 *  PWA needs real PNGs even though the source of truth stays vector.
 *
 *  Regenerate after editing public/app-icon*.svg:
 *    pnpm --filter @pulse/web generate:app-icons
 *  The output is committed — the production build must not depend on a browser. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const targets = [
  { source: "public/app-icon.svg", output: "public/apple-touch-icon.png", size: 180 },
  { source: "public/app-icon.svg", output: "public/app-icon-192.png", size: 192 },
  { source: "public/app-icon.svg", output: "public/app-icon-512.png", size: 512 },
  { source: "public/app-icon-maskable.svg", output: "public/app-icon-maskable-512.png", size: 512 },
];

const browser = await chromium.launch();
try {
  for (const target of targets) {
    const svg = await readFile(resolve(root, target.source), "utf8");
    const page = await browser.newPage({ viewport: { width: target.size, height: target.size }, deviceScaleFactor: 1 });
    // A transparent-background page keeps any rounding in the mark itself; the
    // marks are opaque squares today, so the shot is byte-stable across runs.
    await page.setContent(
      `<!doctype html><html><body style="margin:0;width:${target.size}px;height:${target.size}px">`
      + `<div style="width:${target.size}px;height:${target.size}px">${svg.replace("<svg", `<svg width="${target.size}" height="${target.size}"`)}</div>`
      + `</body></html>`,
      { waitUntil: "load" },
    );
    const buffer = await page.screenshot({ omitBackground: true, type: "png" });
    const outputPath = resolve(root, target.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, buffer);
    await page.close();
    console.log(`${target.output} ${target.size}x${target.size} (${buffer.byteLength} bytes)`);
  }
} finally {
  await browser.close();
}
