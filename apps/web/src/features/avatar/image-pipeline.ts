import {
  AVATAR_ACCEPTED_INPUT_FORMATS,
  AVATAR_MAX_DECODED_PIXELS,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_MIN_SOURCE_EDGE,
  AVATAR_OUTPUT_CONTENT_TYPE,
  AVATAR_OUTPUT_EDGE,
  AVATAR_OUTPUT_MAX_BYTES,
  AVATAR_OUTPUT_QUALITY_STEPS,
  AVATAR_OUTPUT_TARGET_BYTES,
  type AvatarInputFormat,
} from "@pulse/domain";
// sharp is published as `export =`, so a default import binds the value only —
// `sharp.Metadata` is not in scope as a namespace here. The types come in by name.
import sharp, { type Metadata } from "sharp";

/**
 * Avatar image processing (Story 12.6).
 *
 * The contract in one line: whatever comes in, exactly one kind of thing goes out
 * — a 512×512 WebP with no metadata. There is no passthrough, so a crafted file
 * cannot survive as itself, and there is no "trusted" input type, because the
 * declared MIME and the extension are both attacker-controlled.
 *
 * Order matters and is deliberate:
 *
 *  1. byte length, before anything is parsed;
 *  2. header-only metadata read, so a decompression bomb is refused from its
 *     dimensions rather than by allocating the pixels it claims;
 *  3. format allowlist, from what the decoder actually recognised;
 *  4. decode → auto-rotate → centre-square → resize → re-encode;
 *  5. output size check, stepping quality down until the payload fits.
 *
 * `rotate()` before the crop bakes the EXIF orientation into the pixels; the
 * re-encode then drops the metadata block entirely, so orientation survives while
 * GPS, camera model and original filename do not.
 */

export type AvatarRejection =
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_IMAGE_TYPE"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_TOO_SMALL"
  | "IMAGE_UNREADABLE"
  | "IMAGE_ENCODE_FAILED";

export class AvatarImageError extends Error {
  constructor(readonly code: AvatarRejection) {
    super(code);
    this.name = "AvatarImageError";
  }
}

export interface ProcessedAvatar {
  body: Uint8Array;
  contentType: typeof AVATAR_OUTPUT_CONTENT_TYPE;
  byteSize: number;
  width: number;
  height: number;
}

/**
 * `limitInputPixels` is the library-level bomb guard, set to the same ceiling the
 * metadata check enforces so neither path can be bypassed by a header that lies.
 * `sequentialRead` keeps peak memory bounded for large sources.
 */
function open(input: Uint8Array) {
  return sharp(Buffer.from(input), {
    limitInputPixels: AVATAR_MAX_DECODED_PIXELS,
    sequentialRead: true,
    animated: false,
  });
}

export async function processAvatarImage(input: Uint8Array): Promise<ProcessedAvatar> {
  if (input.byteLength === 0) throw new AvatarImageError("IMAGE_UNREADABLE");
  if (input.byteLength > AVATAR_MAX_UPLOAD_BYTES) throw new AvatarImageError("FILE_TOO_LARGE");

  let metadata: Metadata;
  try {
    metadata = await open(input).metadata();
  } catch {
    // A bomb rejected by libvips' own pixel limit also lands here; both are
    // "this file is not something we will decode".
    throw new AvatarImageError("IMAGE_UNREADABLE");
  }

  const format = metadata.format;
  // SVG is refused here: it is a script-bearing document, not a raster image, and
  // librsvg would happily rasterise it. GIF is refused because animation would
  // multiply decode cost for a still 512px result.
  if (!format || !(AVATAR_ACCEPTED_INPUT_FORMATS as readonly string[]).includes(format)) {
    throw new AvatarImageError("UNSUPPORTED_IMAGE_TYPE");
  }
  // A multi-frame WebP is an animation wearing an accepted container's name.
  if ((metadata.pages ?? 1) > 1) throw new AvatarImageError("UNSUPPORTED_IMAGE_TYPE");

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) throw new AvatarImageError("IMAGE_UNREADABLE");
  if (width * height > AVATAR_MAX_DECODED_PIXELS) throw new AvatarImageError("IMAGE_TOO_LARGE");
  // Orientation 5–8 swap the axes, so the *displayed* short edge is the one the
  // minimum applies to.
  const shortEdge = Math.min(width, height);
  if (shortEdge < AVATAR_MIN_SOURCE_EDGE) throw new AvatarImageError("IMAGE_TOO_SMALL");

  for (const quality of AVATAR_OUTPUT_QUALITY_STEPS) {
    let encoded: Buffer;
    try {
      encoded = await open(input)
        // Bakes EXIF orientation into the pixels before anything is cropped.
        .rotate()
        .resize(AVATAR_OUTPUT_EDGE, AVATAR_OUTPUT_EDGE, { fit: "cover", position: "centre", withoutEnlargement: false })
        .webp({ quality, effort: 4 })
        // Deliberately NO withMetadata()/keepMetadata() call. sharp drops every
        // metadata block by default; withMetadata() is the opt-IN that carries it
        // over, and calling it with an empty exif object still writes an EXIF
        // container into the output. Saying nothing here is what strips GPS, the
        // camera model and the original filename.
        .toBuffer();
    } catch {
      throw new AvatarImageError("IMAGE_ENCODE_FAILED");
    }
    if (encoded.byteLength <= AVATAR_OUTPUT_TARGET_BYTES) return finish(encoded);
    // Last step still over target: accept it if it is inside the hard ceiling the
    // database also enforces, otherwise refuse rather than store an outlier.
    if (quality === AVATAR_OUTPUT_QUALITY_STEPS[AVATAR_OUTPUT_QUALITY_STEPS.length - 1]) {
      if (encoded.byteLength <= AVATAR_OUTPUT_MAX_BYTES) return finish(encoded);
      throw new AvatarImageError("IMAGE_ENCODE_FAILED");
    }
  }

  throw new AvatarImageError("IMAGE_ENCODE_FAILED");
}

function finish(encoded: Buffer): ProcessedAvatar {
  return {
    body: new Uint8Array(encoded),
    contentType: AVATAR_OUTPUT_CONTENT_TYPE,
    byteSize: encoded.byteLength,
    width: AVATAR_OUTPUT_EDGE,
    height: AVATAR_OUTPUT_EDGE,
  };
}

/** Test/diagnostic helper: what the decoder actually thinks a buffer is. */
export async function detectAvatarFormat(input: Uint8Array): Promise<AvatarInputFormat | null> {
  try {
    const { format } = await open(input).metadata();
    return format && (AVATAR_ACCEPTED_INPUT_FORMATS as readonly string[]).includes(format)
      ? (format as AvatarInputFormat)
      : null;
  } catch {
    return null;
  }
}
