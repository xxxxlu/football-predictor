import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { APPLE_TOUCH_ICON, MANIFEST_ICONS } from "./src/app/icons";
import manifest from "./src/app/manifest";

/* The PNG marks are generated (`pnpm --filter @pulse/web generate:app-icons`) and
   committed, so a declaration can silently point at a file nobody generated. The
   install prompt then shows a generic glyph — visible only on a real device. */
const publicPath = (source: string) => resolve(import.meta.dirname, "public", source.replace(/^\//, ""));

describe("installable icon set", () => {
  it("ships every icon the manifest advertises", async () => {
    const icons = manifest().icons ?? [];
    expect(icons).toEqual(MANIFEST_ICONS);
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      await expect(access(publicPath(icon.src)), `${icon.src} must exist in public/`).resolves.toBeUndefined();
    }
  });

  it("offers a rasterized icon for both any and maskable purposes", () => {
    const pngFor = (purpose: string) => (MANIFEST_ICONS ?? []).filter((icon) => icon.type === "image/png" && icon.purpose === purpose);
    // Several launchers skip an SVG-only set; without a PNG in each purpose the
    // installed app falls back to a generic glyph.
    expect(pngFor("any").length, "PNG icons for purpose=any").toBeGreaterThan(0);
    expect(pngFor("maskable").length, "PNG icons for purpose=maskable").toBeGreaterThan(0);
  });

  it("declares a PNG apple-touch-icon, which iOS requires", async () => {
    expect(APPLE_TOUCH_ICON).toMatch(/\.png$/);
    // An empty or truncated file passes an existence check; assert the PNG header.
    const header = (await readFile(publicPath(APPLE_TOUCH_ICON))).subarray(0, 8);
    expect([...header]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});
