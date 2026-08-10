import { AVATAR_MAX_UPLOAD_BYTES, AVATAR_OUTPUT_EDGE } from "@pulse/domain";
import sharp, { type Sharp } from "sharp";
import { describe, expect, it } from "vitest";

import { AvatarImageError, detectAvatarFormat, processAvatarImage } from "./image-pipeline";

/**
 * Fixtures are synthesised rather than committed: a checked-in JPEG with real GPS
 * in it is exactly the kind of file this feature exists to strip, and a binary
 * blob in the repo cannot be reviewed.
 */

const solid = (width: number, height: number, channel = 120) =>
  sharp({ create: { width, height, channels: 3, background: { r: channel, g: 40, b: 200 } } });

/** Noise beats a flat fill for size assertions: a solid colour compresses to nothing. */
async function noise(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 7;
  for (let index = 0; index < pixels.length; index += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    pixels[index] = seed % 256;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
}

/** Left half red, right half blue — asymmetric, so a rotation is observable. */
async function twoTone(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 3;
      if (x < width / 2) pixels[at] = 220;
      else pixels[at + 2] = 220;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

/** One RGB sample from a decoded 512×512 result. */
async function pixelAt(body: Uint8Array, x: number, y: number): Promise<{ r: number; b: number }> {
  const { data, info } = await sharp(Buffer.from(body)).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return { r: data[at]!, b: data[at + 2]! };
}

const bytes = async (image: Sharp) => new Uint8Array(await image.toBuffer());

describe("processAvatarImage — accepted inputs", () => {
  it("re-encodes JPEG, PNG and WebP to one 512×512 WebP", async () => {
    for (const source of [solid(900, 600).jpeg(), solid(900, 600).png(), solid(900, 600).webp()]) {
      const result = await processAvatarImage(await bytes(source));
      expect(result.contentType).toBe("image/webp");
      expect(result.width).toBe(AVATAR_OUTPUT_EDGE);
      expect(result.height).toBe(AVATAR_OUTPUT_EDGE);
      const meta = await sharp(Buffer.from(result.body)).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(AVATAR_OUTPUT_EDGE);
      expect(meta.height).toBe(AVATAR_OUTPUT_EDGE);
    }
  });

  it("upscales a small-but-legal source to the full 512 box rather than storing a short edge", async () => {
    const result = await processAvatarImage(await bytes(solid(64, 64).png()));
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
  });

  it("keeps a photographic source inside the 300KB target", async () => {
    // A gradient stands in for a photo: compressible, but not a flat fill.
    const gradient = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 30, g: 90, b: 160 } } })
      .blur(40)
      .jpeg({ quality: 92 })
      .toBuffer();
    const result = await processAvatarImage(new Uint8Array(gradient));
    expect(result.byteSize).toBeLessThanOrEqual(300 * 1024);
    expect(result.byteSize).toBe(result.body.byteLength);
  });

  it("steps quality down rather than storing an outlier when the source is incompressible", async () => {
    // Pure noise defeats the encoder; the ladder still has to land inside the
    // hard ceiling the database CHECK also enforces.
    const result = await processAvatarImage(new Uint8Array(await noise(900, 900)));
    expect(result.byteSize).toBeLessThanOrEqual(512 * 1024);
    expect(result.width).toBe(512);
  });
});

describe("processAvatarImage — metadata is not carried over", () => {
  it("emits no EXIF container at all, so camera, GPS and filename cannot survive", async () => {
    const withExif = await solid(800, 800)
      .withMetadata({
        exif: { IFD0: { Make: "ACME", Model: "ACME Phone 12", Software: "IMG_2026_holiday_beach" } },
        orientation: 6,
      })
      .jpeg()
      .toBuffer();

    // Guard the fixture itself: a test that strips nothing must not pass.
    const before = await sharp(withExif).metadata();
    expect(before.exif).toBeDefined();
    expect(withExif.includes(Buffer.from("ACME"))).toBe(true);

    const result = await processAvatarImage(new Uint8Array(withExif));
    const after = await sharp(Buffer.from(result.body)).metadata();
    // No EXIF block means no GPS block either — GPS only exists inside one.
    expect(after.exif).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    const body = Buffer.from(result.body);
    expect(body.includes(Buffer.from("EXIF"))).toBe(false);
    expect(body.includes(Buffer.from("ACME"))).toBe(false);
    expect(body.includes(Buffer.from("IMG_2026_holiday_beach"))).toBe(false);
  });

  it("bakes the EXIF rotation into the pixels before cropping", async () => {
    // Left half red, right half blue. Orientation 6 means "rotate 90° clockwise
    // to display", which puts the red half on TOP. If rotate() were skipped, red
    // would stay on the left and both samples below would read the same.
    const source = await twoTone(600, 300);
    const tagged = await sharp(source).withMetadata({ orientation: 6 }).toBuffer();

    const result = await processAvatarImage(new Uint8Array(tagged));
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);

    const top = await pixelAt(result.body, 256, 64);
    const bottom = await pixelAt(result.body, 256, 448);
    expect(top.r).toBeGreaterThan(top.b);
    expect(bottom.b).toBeGreaterThan(bottom.r);
  });
});

describe("processAvatarImage — rejections", () => {
  const reject = async (input: Uint8Array, code: string) => {
    await expect(processAvatarImage(input)).rejects.toMatchObject({ name: "AvatarImageError", code });
  };

  it("refuses anything past the 5MB raw ceiling before decoding it", async () => {
    const oversized = new Uint8Array(AVATAR_MAX_UPLOAD_BYTES + 1);
    await reject(oversized, "FILE_TOO_LARGE");
  });

  it("refuses SVG even though librsvg could rasterise it", async () => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><script>fetch("/steal")</script><rect width="600" height="600"/></svg>`,
    );
    await reject(new Uint8Array(svg), "UNSUPPORTED_IMAGE_TYPE");
  });

  it("refuses GIF, including an animated one", async () => {
    const gif = await solid(300, 300).gif().toBuffer();
    await reject(new Uint8Array(gif), "UNSUPPORTED_IMAGE_TYPE");
  });

  it("ignores a spoofed content type: the decoder decides, not the caller", async () => {
    // A GIF renamed to .png and declared image/png is still a GIF here.
    const gif = await solid(300, 300).gif().toBuffer();
    expect(await detectAvatarFormat(new Uint8Array(gif))).toBeNull();
    await reject(new Uint8Array(gif), "UNSUPPORTED_IMAGE_TYPE");

    // ...and a real JPEG declared as image/webp still processes, because the
    // declared type is advisory and the bytes are authoritative.
    const jpeg = await bytes(solid(400, 400).jpeg());
    expect(await detectAvatarFormat(jpeg)).toBe("jpeg");
  });

  it("refuses a decompression bomb from its header, without allocating the pixels", async () => {
    // 6000×6000 = 36M pixels, well past the 20M ceiling, but only a few KB on disk.
    const bomb = await solid(6000, 6000).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.byteLength).toBeLessThan(AVATAR_MAX_UPLOAD_BYTES);
    await expect(processAvatarImage(new Uint8Array(bomb))).rejects.toBeInstanceOf(AvatarImageError);
    await expect(processAvatarImage(new Uint8Array(bomb))).rejects.toMatchObject({
      // libvips may refuse it at its own pixel limit first; either verdict is a refusal.
      code: expect.stringMatching(/^(IMAGE_TOO_LARGE|IMAGE_UNREADABLE)$/),
    });
  });

  it("refuses an image whose short edge is below the crop minimum", async () => {
    await reject(await bytes(solid(400, 32).png()), "IMAGE_TOO_SMALL");
  });

  it("refuses empty and non-image payloads", async () => {
    await reject(new Uint8Array(0), "IMAGE_UNREADABLE");
    await reject(new Uint8Array(Buffer.from("%PDF-1.7\n%not an image")), "IMAGE_UNREADABLE");
    await reject(new Uint8Array(Buffer.from("<?php echo 1; ?>")), "IMAGE_UNREADABLE");
  });
});
