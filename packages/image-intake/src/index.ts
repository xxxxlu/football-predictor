// sharp is published as `export =`, so a default import binds the value only —
// `sharp.Metadata` is not in scope as a namespace here. The types come in by name.
import sharp, { type Metadata } from "sharp";

/**
 * Turning a file a stranger uploaded into an image you are willing to store.
 *
 * The contract in one line: whatever comes in, exactly one kind of thing goes out
 * — a square WebP with no metadata. There is no passthrough path, which is the
 * point. A crafted file cannot survive as itself, and there is no "trusted" input
 * type, because the declared MIME and the file extension are both attacker-
 * controlled and neither is consulted here.
 *
 * The order is deliberate and each step exists because the one before it is not
 * enough:
 *
 *  1. byte length, before anything is parsed at all;
 *  2. a header-only metadata read, so a decompression bomb is refused from the
 *     dimensions it claims rather than by allocating the pixels;
 *  3. a format allowlist applied to what the decoder actually recognised;
 *  4. decode → auto-rotate → centre-square → resize → re-encode;
 *  5. an output size check that steps quality down until the payload fits.
 *
 * `rotate()` before the crop bakes the EXIF orientation into the pixels, and the
 * re-encode then drops the metadata block entirely — so orientation survives
 * while GPS coordinates, camera model and the original filename do not.
 *
 * **Do not add SVG to `acceptedFormats`.** It is a script-bearing document rather
 * than a raster image, and the renderer behind sharp will happily rasterise one,
 * with everything that implies for a file a stranger supplied. Animated formats
 * are refused for a duller reason: they multiply decode cost for a still result.
 */

export type ImageIntakeRejection =
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_IMAGE_TYPE"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_TOO_SMALL"
  | "IMAGE_UNREADABLE"
  | "IMAGE_ENCODE_FAILED";

export class ImageIntakeError extends Error {
  constructor(readonly code: ImageIntakeRejection) {
    super(code);
    this.name = "ImageIntakeError";
  }
}

export interface ImageIntakePolicy {
  /** Largest raw upload accepted before any decode is attempted. */
  maxUploadBytes: number;
  /**
   * Decoded-pixel ceiling. Enforced twice on purpose: once from metadata, and
   * again as sharp's own `limitInputPixels`, so a header that lies cannot get
   * past by claiming small and decoding large.
   */
  maxDecodedPixels: number;
  /** Smallest square the output can be cropped from; below this it is an upscale. */
  minSourceEdge: number;
  /** Container formats to accept, as the decoder names them (`jpeg`, `png`, `webp`). */
  acceptedFormats: readonly string[];
  /** Edge length of the square output. */
  outputEdge: number;
  /** Quality settings to try in order, highest first. */
  outputQualitySteps: readonly number[];
  /** Stop at the first quality whose output is within this. */
  outputTargetBytes: number;
  /** Hard ceiling: an output past this is refused even at the lowest quality. */
  outputMaxBytes: number;
}

export interface IntakenImage {
  body: Uint8Array;
  contentType: "image/webp";
  byteSize: number;
  width: number;
  height: number;
}

export interface ImageIntake {
  /** Normalise an upload, or throw `ImageIntakeError` explaining the refusal. */
  process(input: Uint8Array): Promise<IntakenImage>;
  /** What the decoder actually thinks a buffer is, or null if it is not accepted. */
  detectFormat(input: Uint8Array): Promise<string | null>;
}

export function createImageIntake(policy: ImageIntakePolicy): ImageIntake {
  const open = (input: Uint8Array) =>
    sharp(Buffer.from(input), {
      limitInputPixels: policy.maxDecodedPixels,
      // Keeps peak memory bounded on a large source.
      sequentialRead: true,
      animated: false,
    });

  const finish = (encoded: Buffer): IntakenImage => ({
    body: new Uint8Array(encoded),
    contentType: "image/webp",
    byteSize: encoded.byteLength,
    width: policy.outputEdge,
    height: policy.outputEdge,
  });

  return {
    async process(input) {
      if (input.byteLength === 0) throw new ImageIntakeError("IMAGE_UNREADABLE");
      if (input.byteLength > policy.maxUploadBytes) throw new ImageIntakeError("FILE_TOO_LARGE");

      let metadata: Metadata;
      try {
        metadata = await open(input).metadata();
      } catch {
        // A bomb rejected by the library's own pixel limit lands here too; both
        // mean "this file is not something we will decode".
        throw new ImageIntakeError("IMAGE_UNREADABLE");
      }

      const format = metadata.format;
      if (!format || !policy.acceptedFormats.includes(format)) {
        throw new ImageIntakeError("UNSUPPORTED_IMAGE_TYPE");
      }
      // A multi-frame file is an animation wearing an accepted container's name.
      if ((metadata.pages ?? 1) > 1) throw new ImageIntakeError("UNSUPPORTED_IMAGE_TYPE");

      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (width <= 0 || height <= 0) throw new ImageIntakeError("IMAGE_UNREADABLE");
      if (width * height > policy.maxDecodedPixels) throw new ImageIntakeError("IMAGE_TOO_LARGE");
      // Orientations 5–8 swap the axes, so the minimum applies to the *displayed*
      // short edge, which is the same number either way.
      if (Math.min(width, height) < policy.minSourceEdge) throw new ImageIntakeError("IMAGE_TOO_SMALL");

      const lastStep = policy.outputQualitySteps[policy.outputQualitySteps.length - 1];
      for (const quality of policy.outputQualitySteps) {
        let encoded: Buffer;
        try {
          encoded = await open(input)
            // Bakes EXIF orientation into the pixels before anything is cropped.
            .rotate()
            .resize(policy.outputEdge, policy.outputEdge, {
              fit: "cover",
              position: "centre",
              withoutEnlargement: false,
            })
            .webp({ quality, effort: 4 })
            // Deliberately NO withMetadata()/keepMetadata(). sharp drops every
            // metadata block by default; withMetadata() is the opt-IN that carries
            // it over, and calling it with an empty exif object still writes an
            // EXIF container into the output. Saying nothing here is what strips
            // GPS, the camera model and the original filename.
            .toBuffer();
        } catch {
          throw new ImageIntakeError("IMAGE_ENCODE_FAILED");
        }
        if (encoded.byteLength <= policy.outputTargetBytes) return finish(encoded);
        // Last step still over target: accept it if it is inside the hard ceiling,
        // otherwise refuse rather than store an outlier.
        if (quality === lastStep) {
          if (encoded.byteLength <= policy.outputMaxBytes) return finish(encoded);
          throw new ImageIntakeError("IMAGE_ENCODE_FAILED");
        }
      }

      throw new ImageIntakeError("IMAGE_ENCODE_FAILED");
    },

    async detectFormat(input) {
      try {
        const { format } = await open(input).metadata();
        return format && policy.acceptedFormats.includes(format) ? format : null;
      } catch {
        return null;
      }
    },
  };
}
