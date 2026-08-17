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
import { createImageIntake, ImageIntakeError } from "@pulse/image-intake";

/**
 * Avatar image processing (Story 12.6).
 *
 * The hardening — the ordering of the byte-length, metadata, format and pixel
 * checks, the refusal of SVG and of animation, the re-encode that strips EXIF —
 * lives in `@pulse/image-intake`, which knows nothing about avatars. What stays
 * here is this product's policy: the numbers, and this module's error vocabulary.
 *
 * The error is translated rather than re-exported. `AvatarImageError` is what the
 * handlers and the service catch by `instanceof`, and what a test asserts on by
 * `name`; the package throws its own type, and collapsing the two would make an
 * internal dependency visible in an API contract that has nothing to do with it.
 */

const intake = createImageIntake({
  maxUploadBytes: AVATAR_MAX_UPLOAD_BYTES,
  maxDecodedPixels: AVATAR_MAX_DECODED_PIXELS,
  minSourceEdge: AVATAR_MIN_SOURCE_EDGE,
  acceptedFormats: AVATAR_ACCEPTED_INPUT_FORMATS,
  outputEdge: AVATAR_OUTPUT_EDGE,
  outputQualitySteps: AVATAR_OUTPUT_QUALITY_STEPS,
  outputTargetBytes: AVATAR_OUTPUT_TARGET_BYTES,
  outputMaxBytes: AVATAR_OUTPUT_MAX_BYTES,
});

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

export async function processAvatarImage(input: Uint8Array): Promise<ProcessedAvatar> {
  try {
    const image = await intake.process(input);
    return { ...image, contentType: AVATAR_OUTPUT_CONTENT_TYPE };
  } catch (error) {
    throw translate(error);
  }
}

/** Test/diagnostic helper: what the decoder actually thinks a buffer is. */
export async function detectAvatarFormat(input: Uint8Array): Promise<AvatarInputFormat | null> {
  return (await intake.detectFormat(input)) as AvatarInputFormat | null;
}

/**
 * Rejections carry the same codes on both sides, so this is a rename rather than
 * a mapping. Anything that is not a rejection is rethrown untouched: a bug in the
 * pipeline must not arrive at the handler wearing a user-facing refusal code.
 */
function translate(error: unknown): unknown {
  return error instanceof ImageIntakeError ? new AvatarImageError(error.code) : error;
}
