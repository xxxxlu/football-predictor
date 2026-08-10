/**
 * User avatars — the policy layer (Story 12.6).
 *
 * Everything a caller needs to reason about an avatar without touching an image
 * codec, an object-storage SDK or the database lives here: the accepted input
 * envelope, the single re-encoded output shape, the change quota, the public URL
 * derivation and the fallback that renders when no avatar exists.
 *
 * Two boundaries are deliberate:
 *
 * 1. `AvatarStorage` is an interface, not an implementation. The upload service
 *    orchestrates storage and database writes through it, so the CloudBase SDK
 *    stays in one adapter and every test drives a fake.
 * 2. The public URL is derived from a random `publicId` the avatar row owns, not
 *    from the object key. The storage path never reaches a client, and a
 *    projection that carries an avatar discloses nothing beyond "this account has
 *    avatar version N".
 */

/** Largest raw upload accepted before any decode is attempted. */
export const AVATAR_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Decoded-pixel ceiling, checked from image *metadata* before a full decode so a
 * 40-kilobyte file that claims 30000×30000 is refused instead of allocating
 * gigabytes (the classic decompression bomb).
 */
export const AVATAR_MAX_DECODED_PIXELS = 20_000_000;

/** Smallest square an avatar can be cropped from; below this an upscale is all it would be. */
export const AVATAR_MIN_SOURCE_EDGE = 64;

/**
 * Accepted *container* formats. SVG is absent because it is a script-bearing
 * document, and GIF because animation would multiply decode cost for a 512px
 * still. The container is confirmed by decoding, never by the declared MIME type
 * or the file extension.
 */
export const AVATAR_ACCEPTED_INPUT_FORMATS = ["jpeg", "png", "webp"] as const;
export type AvatarInputFormat = (typeof AVATAR_ACCEPTED_INPUT_FORMATS)[number];

/** The client-declared types the endpoint will even look at. Advisory only. */
export const AVATAR_ACCEPTED_INPUT_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Every stored avatar is re-encoded to exactly this. There is no passthrough path. */
export const AVATAR_OUTPUT_CONTENT_TYPE = "image/webp" as const;
export const AVATAR_OUTPUT_EDGE = 512;
/** Encoder target. Quality steps down until the payload fits, so this is a ceiling, not a guess. */
export const AVATAR_OUTPUT_TARGET_BYTES = 300 * 1024;
/** Hard ceiling: if even the lowest quality step misses the target we still refuse anything above this. */
export const AVATAR_OUTPUT_MAX_BYTES = 512 * 1024;
export const AVATAR_OUTPUT_QUALITY_STEPS = [82, 74, 66, 58, 50] as const;

/** Persisted change quota (mirrors the social-write quota shape: attempts are priced, not successes). */
export const AVATAR_CHANGES_PER_HOUR = 5;
export const AVATAR_CHANGES_PER_DAY = 20;

/** Rendered sizes the shared component understands, in CSS pixels. */
export const AVATAR_SIZES = [24, 32, 36, 40, 56, 96] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

export type AvatarModerationStatus = "APPROVED" | "PENDING" | "REMOVED";
export const AVATAR_MODERATION_STATUSES: readonly AvatarModerationStatus[] = ["APPROVED", "PENDING", "REMOVED"];

/** Where the bytes live. Random on both segments; never a nickname, a PULSE ID or an original filename. */
export function avatarObjectKey(objectId: string, version: number): string {
  assertAvatarIdentifier(objectId, "objectId");
  assertAvatarVersion(version);
  return `avatars/${objectId}/${version}.webp`;
}

/**
 * The same-origin path a browser loads. Deliberately not a CloudBase URL: the
 * bucket is private-read, the temporary URL is minted server-side per request and
 * never leaves the server, and `img-src 'self'` needs no widening.
 */
export function avatarMediaPath(publicId: string, version: number): string {
  assertAvatarIdentifier(publicId, "publicId");
  assertAvatarVersion(version);
  return `/api/v1/media/avatars/${publicId}/${version}.webp`;
}

/** Inverse of `avatarMediaPath`, for the media route. Returns null for anything malformed. */
export function parseAvatarMediaPath(path: string): { publicId: string; version: number } | null {
  const match = /^\/api\/v1\/media\/avatars\/([0-9a-f-]{36})\/(\d{1,9})\.webp$/.exec(path);
  if (!match) return null;
  const version = Number(match[2]);
  if (!Number.isSafeInteger(version) || version < 1) return null;
  return { publicId: match[1]!, version };
}

/**
 * The only two fields an avatar contributes to a social projection. `avatarUrl`
 * is null for an account with no avatar; the caller then renders initials.
 */
export interface AvatarProjection {
  avatarUrl: string | null;
  avatarVersion: number | null;
}

export const AVATAR_PROJECTION_KEYS = ["avatarUrl", "avatarVersion"] as const;

export const NO_AVATAR: AvatarProjection = { avatarUrl: null, avatarVersion: null };

/** Builds the projection pair from a row, tolerating the LEFT JOIN's nulls. */
export function avatarProjection(
  row: { avatarPublicId?: string | null; avatarVersion?: number | string | null } | null | undefined,
): AvatarProjection {
  const publicId = row?.avatarPublicId ?? null;
  const rawVersion = row?.avatarVersion ?? null;
  if (!publicId || rawVersion === null) return NO_AVATAR;
  const version = Number(rawVersion);
  if (!Number.isSafeInteger(version) || version < 1) return NO_AVATAR;
  return { avatarUrl: avatarMediaPath(publicId, version), avatarVersion: version };
}

/**
 * The letter a default avatar shows. Nickname first (it is what members
 * recognise), PULSE ID second, and a neutral glyph when an account has neither —
 * never an empty circle, because an empty circle reads as a broken image.
 */
export function avatarInitial(nickname: string | null | undefined, pulseId?: string | null): string {
  const source = firstMeaningfulCharacter(nickname) ?? firstMeaningfulCharacter(pulseId);
  return source ? source.toUpperCase() : "#";
}

function firstMeaningfulCharacter(value: string | null | undefined): string | null {
  if (!value) return null;
  for (const character of Array.from(value.trim())) {
    // Skip punctuation and separators so "@lu" initials as L, not @.
    if (/[\p{L}\p{N}]/u.test(character)) return character;
  }
  return null;
}

/**
 * Deterministic tone index for the default avatar, so the same account keeps the
 * same colour on every surface and across reloads without storing anything.
 */
export const AVATAR_FALLBACK_TONES = 6;
export function avatarFallbackTone(seed: string | null | undefined): number {
  if (!seed) return 0;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 1_000_003;
  }
  return hash % AVATAR_FALLBACK_TONES;
}

/**
 * Everything the shared renderer needs, decided in one place so the friend list,
 * the lobby, the chats and the member pass cannot drift.
 *
 * Two failure modes collapse into one outcome deliberately: an account with no
 * avatar and an avatar whose image failed to load both render initials. A broken
 * image glyph is never an acceptable third state, and the box is sized from
 * `size` in both dimensions whichever branch is taken, so a slow, missing or
 * broken photo can never reflow the row it sits in.
 */
export interface AvatarRenderPlan {
  mode: "image" | "initials";
  initial: string;
  tone: number;
  /** Both dimensions, so the reserved box exists before the image does. */
  box: number;
}

export function avatarRenderPlan(input: {
  src?: string | null;
  failed?: boolean;
  nickname?: string | null;
  pulseId?: string | null;
  size?: number;
}): AvatarRenderPlan {
  const size = input.size ?? 40;
  return {
    mode: input.src && !input.failed ? "image" : "initials",
    initial: avatarInitial(input.nickname, input.pulseId),
    tone: avatarFallbackTone(input.pulseId ?? input.nickname ?? ""),
    box: size,
  };
}

/**
 * The PHOTO audit note an avatar upload may leave in the privacy centre. An
 * avatar is account content the member chose to publish, so the audit trail
 * records that an upload happened and how big it was — never the image, and
 * never anything the pipeline just stripped.
 *
 * The banned-key list is enforced rather than documented: a future writer that
 * adds `dataUrl`, `exif`, `gps` or `fileName` fails here instead of quietly
 * persisting it (the 0029 privacy-centre red line).
 */
/**
 * Matched against the key normalised to snake_case, with whole-segment
 * boundaries — the same technique the governance audit redactor uses. A bare
 * substring test is wrong here: `bytes` occurs inside `byteSize`, which is a
 * field this metadata is *required* to carry, so the guard would have rejected
 * its own output.
 */
const FORBIDDEN_AUDIT_KEY =
  /(^|_)(bytes|buffer|blob|payload|base64|data_url|dataurl|raw|exif|gps|lat|latitude|lng|longitude|geo|coord|coords|location|filename|file_name|original_name|originalname|device|model)(_|$)/;

export interface AvatarAuditMetadata {
  kind: "AVATAR_UPLOADED";
  contentType: typeof AVATAR_OUTPUT_CONTENT_TYPE;
  byteSize: number;
  width: number;
  height: number;
  avatarVersion: number;
  uploadedAt: string;
}

export function avatarAuditMetadata(input: {
  byteSize: number;
  width: number;
  height: number;
  version: number;
  uploadedAt: Date | string;
}): AvatarAuditMetadata {
  const metadata: AvatarAuditMetadata = {
    kind: "AVATAR_UPLOADED",
    contentType: AVATAR_OUTPUT_CONTENT_TYPE,
    byteSize: input.byteSize,
    width: input.width,
    height: input.height,
    avatarVersion: input.version,
    uploadedAt: input.uploadedAt instanceof Date ? input.uploadedAt.toISOString() : input.uploadedAt,
  };
  assertAvatarAuditMetadata(metadata);
  return metadata;
}

export function assertAvatarAuditMetadata(value: unknown): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const entry of value) assertAvatarAuditMetadata(entry);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const snake = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    if (FORBIDDEN_AUDIT_KEY.test(snake)) throw new Error(`avatar audit metadata must never carry "${key}"`);
    assertAvatarAuditMetadata(nested);
  }
}

/**
 * Object storage, as the avatar service needs it. Four operations, no SDK types:
 * the CloudBase adapter, the in-memory fake used by the tests and any future
 * backend all satisfy this.
 */
export interface AvatarStorage {
  /** Uploads bytes at `objectKey` and returns the backend's own file handle. */
  put(input: { objectKey: string; body: Uint8Array; contentType: string }): Promise<{ fileId: string }>;
  /** Deletes one object. Must resolve for an object that is already gone. */
  remove(input: { objectKey: string; fileId?: string | null }): Promise<void>;
  /**
   * Mints a short-lived read URL for a private object. Server-side use only —
   * the URL is fetched and streamed, never handed to a browser and never logged.
   */
  temporaryUrl(input: { objectKey: string; fileId?: string | null; ttlSeconds?: number }): Promise<string>;
  /** Reads one object's bytes. Adapters may implement this over `temporaryUrl`. */
  read(input: { objectKey: string; fileId?: string | null }): Promise<{ body: Uint8Array; contentType: string }>;
}

/** Default lifetime of a minted read URL. Short: it only has to survive one server-side fetch. */
export const AVATAR_TEMPORARY_URL_TTL_SECONDS = 120;

/**
 * Storage failures carry a stable code and nothing else. The message never
 * embeds a bucket, an object key, a temporary URL or an SDK payload, because it
 * travels into an API error envelope.
 */
export class AvatarStorageError extends Error {
  constructor(readonly code: "STORAGE_UPLOAD_FAILED" | "STORAGE_DELETE_FAILED" | "STORAGE_READ_FAILED" | "STORAGE_NOT_CONFIGURED") {
    super(code);
    this.name = "AvatarStorageError";
  }
}

function assertAvatarIdentifier(value: string, field: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw new Error(`avatar ${field} must be a random uuid`);
  }
}

function assertAvatarVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("avatar version must be a positive integer");
}
