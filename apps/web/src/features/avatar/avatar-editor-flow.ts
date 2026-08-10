import { AVATAR_ACCEPTED_INPUT_CONTENT_TYPES, AVATAR_MAX_UPLOAD_BYTES, AVATAR_MIN_SOURCE_EDGE } from "@pulse/domain";

/**
 * The account page's avatar editor, as pure functions (Story 12.6).
 *
 * Split out of the component for the same reason as every other `*-flow.ts` in
 * this app: the crop geometry, the accept/refuse rules and the message table are
 * the parts worth testing, and none of them need a DOM.
 *
 * The flow the geometry serves is deliberately four steps, not two:
 *
 *   choose → crop and preview → confirm → upload
 *
 * Picking a file is never itself an upload. Nothing leaves the device until the
 * member has seen the square they are about to publish and pressed save.
 */

export type SelectionRefusal = "FILE_TOO_LARGE" | "UNSUPPORTED_IMAGE_TYPE" | "IMAGE_TOO_SMALL" | "IMAGE_UNREADABLE";

/**
 * Client-side pre-check on the chosen file. A courtesy, never a boundary: the
 * server re-checks the size, decodes the bytes to learn the real format and
 * re-encodes the result regardless of what this returns.
 */
export function describeSelection(file: { size: number; type: string }): { ok: true } | { ok: false; code: SelectionRefusal } {
  if (file.size <= 0) return { ok: false, code: "IMAGE_UNREADABLE" };
  if (file.size > AVATAR_MAX_UPLOAD_BYTES) return { ok: false, code: "FILE_TOO_LARGE" };
  const type = file.type.toLowerCase();
  // An empty type happens on some Android pickers; let the server decide there.
  if (type && !(AVATAR_ACCEPTED_INPUT_CONTENT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, code: "UNSUPPORTED_IMAGE_TYPE" };
  }
  return { ok: true };
}

export interface CropSource {
  width: number;
  height: number;
}

export interface CropState {
  /** 1 = the image's short edge exactly fills the square stage. */
  scale: number;
  /** Top-left of the drawn image, in stage pixels. Always ≤ 0. */
  offsetX: number;
  offsetY: number;
}

export const CROP_MIN_SCALE = 1;
export const CROP_MAX_SCALE = 4;

/** Scale at which the short edge covers the stage exactly — the zoom floor. */
export function coverScale(source: CropSource, stage: number): number {
  return stage / Math.max(1, Math.min(source.width, source.height));
}

export function isCroppableSource(source: CropSource): boolean {
  return Math.min(source.width, source.height) >= AVATAR_MIN_SOURCE_EDGE;
}

/** Opens centred at the zoom floor: the whole short edge, nothing cut arbitrarily. */
export function initialCropState(source: CropSource, stage: number): CropState {
  const base = coverScale(source, stage) * CROP_MIN_SCALE;
  return {
    scale: CROP_MIN_SCALE,
    offsetX: (stage - source.width * base) / 2,
    offsetY: (stage - source.height * base) / 2,
  };
}

/**
 * Keeps the square fully covered. Panning can never expose a transparent edge,
 * and a scale below the floor is pulled back up, so there is no state in which
 * the preview and the uploaded crop could disagree.
 */
export function clampCrop(state: CropState, source: CropSource, stage: number): CropState {
  const scale = Math.min(CROP_MAX_SCALE, Math.max(CROP_MIN_SCALE, state.scale));
  const base = coverScale(source, stage) * scale;
  // Both bounds are ≤ 0; the dimension that exactly fits pins its offset to 0.
  const minX = Math.min(0, stage - source.width * base);
  const minY = Math.min(0, stage - source.height * base);
  const offsetX = Number.isFinite(state.offsetX) ? state.offsetX : minX / 2;
  const offsetY = Number.isFinite(state.offsetY) ? state.offsetY : minY / 2;
  return {
    scale,
    offsetX: Math.min(0, Math.max(minX, offsetX)),
    offsetY: Math.min(0, Math.max(minY, offsetY)),
  };
}

export interface CropRect {
  sx: number;
  sy: number;
  size: number;
}

/**
 * The square of the *source* image the stage is showing, in source pixels. This
 * is what gets drawn into the export canvas, so the bytes uploaded are exactly
 * the square the member confirmed.
 */
export function cropRect(state: CropState, source: CropSource, stage: number): CropRect {
  const base = coverScale(source, stage) * state.scale;
  const size = stage / base;
  const sx = Math.max(0, Math.min(source.width - size, -state.offsetX / base));
  const sy = Math.max(0, Math.min(source.height - size, -state.offsetY / base));
  return { sx, sy, size };
}

/**
 * Export edge for the confirmed crop. Capped at 1024: the server re-encodes to
 * 512 anyway, and shipping more than one extra level of detail only costs the
 * member's data plan.
 */
export const CROP_EXPORT_EDGE = 1024;
export function exportEdge(rect: CropRect): number {
  return Math.max(AVATAR_MIN_SOURCE_EDGE, Math.min(CROP_EXPORT_EDGE, Math.round(rect.size)));
}

/** Field name the endpoint reads. Multipart, never base64-in-JSON. */
export const AVATAR_FORM_FIELD = "avatar";

export const AVATAR_MESSAGES: Record<string, string> = {
  FILE_TOO_LARGE: "图片需要小于 5MB，换一张再试。",
  UNSUPPORTED_IMAGE_TYPE: "只支持 JPEG、PNG 或 WebP 照片。",
  IMAGE_TOO_LARGE: "这张图片像素太大，换一张小一点的。",
  IMAGE_TOO_SMALL: "这张图片太小，无法裁剪成头像。",
  IMAGE_UNREADABLE: "这个文件无法作为图片读取。",
  IMAGE_ENCODE_FAILED: "这张图片处理失败，换一张再试。",
  PHOTO_CONSENT_REVOKED: "你已关闭照片授权，重新授权后才能上传头像。",
  RATE_LIMITED: "头像更换太频繁，请稍后再试。",
  AVATAR_STORAGE_FAILED: "头像存储暂时不可用，请稍后重试。",
  AVATAR_UNAVAILABLE: "当前环境未开启头像功能。",
  UNAUTHENTICATED: "请重新登录后再试。",
  INVALID_ORIGIN: "请刷新页面后重试。",
  INVALID_REQUEST: "请检查所选文件后重试。",
};

export function avatarMessage(code: string | undefined, fallback = "头像操作失败，请重试。"): string {
  return (code && AVATAR_MESSAGES[code]) || fallback;
}
