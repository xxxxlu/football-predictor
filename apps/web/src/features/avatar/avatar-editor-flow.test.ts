import { readFile } from "node:fs/promises";
import { AVATAR_MAX_UPLOAD_BYTES } from "@pulse/domain";
import { describe, expect, it } from "vitest";

import {
  avatarMessage,
  AVATAR_FORM_FIELD,
  AVATAR_MESSAGES,
  clampCrop,
  coverScale,
  CROP_EXPORT_EDGE,
  CROP_MAX_SCALE,
  CROP_MIN_SCALE,
  cropRect,
  describeSelection,
  exportEdge,
  initialCropState,
  isCroppableSource,
} from "./avatar-editor-flow";

const STAGE = 320;

describe("selection pre-check", () => {
  it("accepts the three supported types and an unknown type from a mobile picker", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", ""]) {
      expect(describeSelection({ size: 1024, type })).toEqual({ ok: true });
    }
  });

  it("refuses oversized, empty and unsupported files with the codes the copy table knows", () => {
    expect(describeSelection({ size: AVATAR_MAX_UPLOAD_BYTES + 1, type: "image/jpeg" })).toEqual({ ok: false, code: "FILE_TOO_LARGE" });
    expect(describeSelection({ size: 0, type: "image/jpeg" })).toEqual({ ok: false, code: "IMAGE_UNREADABLE" });
    for (const type of ["image/svg+xml", "image/gif", "application/pdf", "text/html"]) {
      expect(describeSelection({ size: 1024, type })).toEqual({ ok: false, code: "UNSUPPORTED_IMAGE_TYPE" });
    }
  });
});

describe("crop geometry", () => {
  const landscape = { width: 1600, height: 900 };
  const portrait = { width: 900, height: 1600 };
  const square = { width: 800, height: 800 };

  it("opens centred with the whole short edge visible", () => {
    for (const source of [landscape, portrait, square]) {
      const state = initialCropState(source, STAGE);
      expect(state.scale).toBe(CROP_MIN_SCALE);
      const rect = cropRect(state, source, STAGE);
      // The crop square equals the short edge, centred on the long axis.
      expect(rect.size).toBeCloseTo(Math.min(source.width, source.height), 5);
      expect(rect.sx).toBeCloseTo((source.width - rect.size) / 2, 5);
      expect(rect.sy).toBeCloseTo((source.height - rect.size) / 2, 5);
    }
  });

  it("never lets a pan expose an uncovered edge", () => {
    const source = landscape;
    const base = coverScale(source, STAGE);
    // Drag hard in every direction; the square must stay fully covered.
    for (const [dx, dy] of [[9999, 9999], [-9999, -9999], [9999, -9999], [-9999, 9999]]) {
      const clamped = clampCrop({ scale: 1, offsetX: dx, offsetY: dy }, source, STAGE);
      expect(clamped.offsetX).toBeLessThanOrEqual(0);
      expect(clamped.offsetY).toBeLessThanOrEqual(0);
      expect(clamped.offsetX).toBeGreaterThanOrEqual(STAGE - source.width * base - 1e-9);
      expect(clamped.offsetY).toBeGreaterThanOrEqual(Math.min(0, STAGE - source.height * base) - 1e-9);
      const rect = cropRect(clamped, source, STAGE);
      expect(rect.sx).toBeGreaterThanOrEqual(0);
      expect(rect.sy).toBeGreaterThanOrEqual(0);
      expect(rect.sx + rect.size).toBeLessThanOrEqual(source.width + 1e-9);
      expect(rect.sy + rect.size).toBeLessThanOrEqual(source.height + 1e-9);
    }
  });

  it("clamps zoom to the declared range and shrinks the crop as it goes in", () => {
    expect(clampCrop({ scale: 0.1, offsetX: 0, offsetY: 0 }, square, STAGE).scale).toBe(CROP_MIN_SCALE);
    expect(clampCrop({ scale: 99, offsetX: 0, offsetY: 0 }, square, STAGE).scale).toBe(CROP_MAX_SCALE);

    const wide = cropRect(clampCrop({ scale: 1, offsetX: 0, offsetY: 0 }, square, STAGE), square, STAGE);
    const tight = cropRect(clampCrop({ scale: 4, offsetX: 0, offsetY: 0 }, square, STAGE), square, STAGE);
    expect(tight.size).toBeLessThan(wide.size);
    expect(tight.size).toBeCloseTo(wide.size / 4, 5);
  });

  it("survives a NaN offset instead of exporting a broken rect", () => {
    const clamped = clampCrop({ scale: 1, offsetX: Number.NaN, offsetY: Number.NaN }, landscape, STAGE);
    expect(Number.isFinite(clamped.offsetX)).toBe(true);
    expect(Number.isFinite(clamped.offsetY)).toBe(true);
  });

  it("caps the exported edge so the upload is never larger than it needs to be", () => {
    expect(exportEdge({ sx: 0, sy: 0, size: 4000 })).toBe(CROP_EXPORT_EDGE);
    expect(exportEdge({ sx: 0, sy: 0, size: 700 })).toBe(700);
    expect(exportEdge({ sx: 0, sy: 0, size: 10 })).toBe(64);
  });

  it("knows a source too small to crop", () => {
    expect(isCroppableSource({ width: 63, height: 900 })).toBe(false);
    expect(isCroppableSource({ width: 64, height: 64 })).toBe(true);
  });
});

describe("upload contract and copy", () => {
  it("posts a multipart field, never a base64 JSON body", () => {
    expect(AVATAR_FORM_FIELD).toBe("avatar");
  });

  it("has localised copy for every code the API can return", () => {
    for (const code of [
      "FILE_TOO_LARGE",
      "UNSUPPORTED_IMAGE_TYPE",
      "IMAGE_TOO_LARGE",
      "IMAGE_TOO_SMALL",
      "IMAGE_UNREADABLE",
      "IMAGE_ENCODE_FAILED",
      "PHOTO_CONSENT_REVOKED",
      "RATE_LIMITED",
      "AVATAR_STORAGE_FAILED",
      "AVATAR_UNAVAILABLE",
      "UNAUTHENTICATED",
      "INVALID_ORIGIN",
      "INVALID_REQUEST",
    ]) {
      expect(AVATAR_MESSAGES[code]).toBeTruthy();
      expect(avatarMessage(code)).toBe(AVATAR_MESSAGES[code]);
    }
    expect(avatarMessage("SOMETHING_NEW")).toBe("头像操作失败，请重试。");
    expect(avatarMessage(undefined)).toBe("头像操作失败，请重试。");
  });
});

/**
 * The 390 × 844 check, as a static contract rather than a rendered measurement:
 * `pnpm test` has no browser, and the pieces that could overflow a 390px viewport
 * are all declared in one stylesheet. Anything with a fixed width wider than the
 * viewport, or an unbounded crop stage, fails here.
 */
describe("mobile layout contract (390 × 844)", () => {
  const VIEWPORT = 390;

  /**
   * CSS comments are stripped on the way in. A commented header sits directly
   * above most of these rules, and the selector capture below cannot tell one
   * from the other — leaving them in makes an exact-selector lookup miss every
   * rule that happens to be documented.
   */
  const stylesheet = async () =>
    (await readFile(new URL("../../app/globals.css", import.meta.url), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  /** Every rule whose (trimmed) selector list mentions the given selector text. */
  const rulesFor = (css: string, selectorFragment: string) =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(([, selector, body]) => ({ selector: selector!.trim(), body: body! }))
      .filter((rule) => rule.selector.includes(selectorFragment));
  /** Exactly one rule, matched on the whole selector — no prefix collisions. */
  const ruleFor = (css: string, selector: string) =>
    rulesFor(css, selector).find((rule) => rule.selector === selector);

  it("caps the crop stage below the viewport and keeps the avatar box square", async () => {
    const css = await stylesheet();
    const stage = ruleFor(css, ".avatar-editor__stage");
    expect(stage?.body).toContain("width: 100%");
    // 20rem = 320px, comfortably inside 390 minus the page gutters.
    expect(stage?.body).toMatch(/max-width:\s*20rem/);

    const canvas = ruleFor(css, ".avatar-editor__canvas");
    expect(canvas?.body).toContain("width: 100%");
    expect(canvas?.body).toContain("height: auto");
    expect(canvas?.body).toMatch(/aspect-ratio:\s*1/);
  });

  it("declares no avatar or editor rule wider than the viewport", async () => {
    const css = await stylesheet();
    for (const rule of [...rulesFor(css, ".pulse-avatar"), ...rulesFor(css, ".avatar-editor")]) {
      for (const [, value, unit] of rule.body.matchAll(/(?:^|[\s;])(?:min-)?width:\s*([\d.]+)(px|rem)/g)) {
        const px = unit === "rem" ? Number(value) * 16 : Number(value);
        expect.soft(px, `${rule.selector} declares a ${px}px width`).toBeLessThanOrEqual(VIEWPORT);
      }
    }
  });

  it("lets the editor row wrap instead of pushing the page sideways", async () => {
    const css = await stylesheet();
    for (const selector of [".avatar-editor", ".avatar-editor__actions"]) {
      // ruleFor, not rulesFor: ".avatar-editor" is a prefix of every BEM child
      // here, so a fragment match would silently assert on the wrong rule.
      expect(ruleFor(css, selector)?.body, `${selector} must wrap`).toContain("flex-wrap: wrap");
    }
  });

  it("keeps every editor control at a 44px touch target", async () => {
    const css = await stylesheet();
    const button = ruleFor(css, ".avatar-editor__button");
    expect(button?.body).toMatch(/min-height:\s*44px/);
    expect(button?.body).toMatch(/min-width:\s*44px/);
  });

  it("clips the loaded image to the avatar box so a wide photo cannot stretch a row", async () => {
    const css = await stylesheet();
    const box = ruleFor(css, ".pulse-avatar");
    expect(box, "no .pulse-avatar rule found").toBeDefined();
    expect(box!.body).toContain("overflow: hidden");
    expect(box!.body).toContain("flex: none");
    const image = ruleFor(css, ".pulse-avatar > img");
    expect(image, "no .pulse-avatar > img rule found").toBeDefined();
    expect(image!.body).toContain("width: 100%");
    expect(image!.body).toContain("height: 100%");
    expect(image!.body).toContain("object-fit: cover");
  });
});
