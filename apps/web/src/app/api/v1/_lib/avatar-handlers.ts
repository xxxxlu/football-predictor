import { AuthError, AVATAR_ACCEPTED_INPUT_CONTENT_TYPES, AVATAR_MAX_UPLOAD_BYTES, AvatarStorageError } from "@pulse/domain";
import { OperationError } from "@pulse/db";
import { avatarErrorResponse, type AvatarService } from "@/features/avatar/avatar-service";
import { AvatarImageError } from "@/features/avatar/image-pipeline";
import { readSessionToken } from "../auth/_lib/session-token";
import { assertSameOrigin } from "./request-origin";

/**
 * Avatar endpoints (Story 12.6).
 *
 * Upload is `multipart/form-data`, never JSON-with-base64: base64 inflates the
 * payload by a third, forces the whole image through a string, and makes the size
 * limit a property of the encoding rather than of the file.
 *
 * The media route is same-origin by construction. CloudBase is private-read and
 * the temporary URL is fetched server-side, so the browser only ever sees
 * `/api/v1/media/...` — which the existing `img-src 'self'` CSP already allows,
 * with no host to widen and no signed URL to leak into a referrer or a log.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Multipart framing (boundaries, headers) around a 5 MB file. Refused before parsing. */
const MAX_MULTIPART_BYTES = AVATAR_MAX_UPLOAD_BYTES + 64 * 1024;
/** Immutable: the version is in the path, so a replacement is a different URL. */
const MEDIA_CACHE_CONTROL = "private, max-age=604800, immutable";

interface Identity {
  authenticate(token: string): Promise<{ id: string } | null>;
}

export function createAvatarHandlers(identity: Identity, service: AvatarService) {
  const user = async (request: Request) => {
    const token = readSessionToken(request);
    const account = token ? await identity.authenticate(token) : null;
    if (!account) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return account.id;
  };

  return {
    /** POST /api/v1/account/avatar — upload the member's confirmed crop. */
    upload: (request: Request) =>
      execute(async () => {
        assertSameOrigin(request);
        const id = await user(request);

        // Declared length first: a 400 MB body must be refused before Next
        // buffers it, not after. The real byte count is re-checked below, because
        // a client controls this header.
        const declared = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(declared) && declared > MAX_MULTIPART_BYTES) {
          return failure("FILE_TOO_LARGE", 413);
        }
        if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
          return failure("INVALID_REQUEST", 415);
        }

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return failure("INVALID_REQUEST", 422);
        }
        const file = form.get("avatar");
        if (!(file instanceof File)) return failure("INVALID_REQUEST", 422);
        if (file.size > AVATAR_MAX_UPLOAD_BYTES) return failure("FILE_TOO_LARGE", 413);
        // The declared type is a cheap pre-filter only. What the file *is* gets
        // decided by the decoder in the pipeline, which is the check that counts.
        if (file.type && !(AVATAR_ACCEPTED_INPUT_CONTENT_TYPES as readonly string[]).includes(file.type.toLowerCase())) {
          return failure("UNSUPPORTED_IMAGE_TYPE", 422);
        }

        const bytes = new Uint8Array(await file.arrayBuffer());
        const avatar = await service.upload(id, bytes, {
          ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
          userAgent: request.headers.get("user-agent") ?? undefined,
        });
        return json({ data: avatar });
      }),

    /** DELETE /api/v1/account/avatar — remove it. Idempotent. */
    remove: (request: Request) =>
      execute(async () => {
        assertSameOrigin(request);
        const id = await user(request);
        return json({ data: await service.remove(id) });
      }),

    /**
     * GET /api/v1/media/avatars/{publicId}/{version}.webp — the bytes.
     *
     * Authenticated: an avatar is visible wherever the account's nickname already
     * is, and every one of those surfaces requires a session. The path carries a
     * random public id, so it is unguessable even before that check.
     */
    media: (request: Request, publicId: string, file: string) =>
      execute(async () => {
        await user(request);
        const match = /^(\d{1,9})\.webp$/.exec(file);
        if (!UUID_PATTERN.test(publicId) || !match) return failure("NOT_FOUND", 404);
        const version = Number(match[1]);
        // Versions start at 1 (the 0030 CHECK says so); `0.webp` parses but can
        // never name a real object, so it is refused before any lookup.
        if (version < 1) return failure("NOT_FOUND", 404);

        // Revalidation is answered from the URL alone. The version is part of the
        // path and the response is immutable, so a matching ETag proves the client
        // already holds these exact bytes — fetching them from the bucket to throw
        // them away would spend a storage round-trip per cache hit.
        const etag = `"avatar-${publicId}-${version}"`;
        if (request.headers.get("if-none-match") === etag) {
          return new Response(null, { status: 304, headers: { etag, "cache-control": MEDIA_CACHE_CONTROL } });
        }

        const found = await service.readMedia(publicId, version);
        if (!found) return failure("NOT_FOUND", 404);

        return new Response(found.body as BodyInit, {
          status: 200,
          headers: {
            "content-type": found.contentType,
            "content-length": String(found.body.byteLength),
            "cache-control": MEDIA_CACHE_CONTROL,
            "x-content-type-options": "nosniff",
            etag,
          },
        });
      }),
  };
}

const noStore = { "cache-control": "no-store" };

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Log in to continue.",
  INVALID_ORIGIN: "Reload this page and try again.",
  PHOTO_CONSENT_REVOKED: "Photo access is turned off for this account. Turn it back on to upload an avatar.",
  RATE_LIMITED: "You have changed your avatar too many times. Try again later.",
  FILE_TOO_LARGE: "Pick an image under 5 MB.",
  UNSUPPORTED_IMAGE_TYPE: "Use a JPEG, PNG or WebP photo.",
  IMAGE_TOO_LARGE: "That image has too many pixels. Pick a smaller one.",
  IMAGE_TOO_SMALL: "That image is too small to crop. Pick one at least 64 pixels wide.",
  IMAGE_UNREADABLE: "That file could not be read as an image.",
  IMAGE_ENCODE_FAILED: "That image could not be processed. Try another one.",
  AVATAR_STORAGE_FAILED: "Avatar storage is unavailable right now. Try again shortly.",
  AVATAR_UNAVAILABLE: "Avatars are not available in this environment.",
  NOT_FOUND: "The requested avatar was not found.",
  INVALID_REQUEST: "Check the submitted fields and try again.",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

/**
 * One failure shape for every path. Storage and database detail never reaches
 * here: an unexpected error becomes INTERNAL_ERROR, and the original is logged
 * without a URL, a key or a payload.
 */
function failure(code: string, status: number) {
  return Response.json(
    { error: { code, message: MESSAGES[code] ?? "The request could not be completed." } },
    { status, headers: noStore },
  );
}

async function execute(operation: () => Promise<Response>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AuthError) return failure(error.code, error.status);
    if (error instanceof OperationError) return failure(error.code, error.status);
    const mapped = avatarErrorResponse(error);
    if (mapped) return failure(mapped.code, mapped.status);
    if (error instanceof AvatarImageError || error instanceof AvatarStorageError) {
      return failure("INTERNAL_ERROR", 500);
    }
    console.error("[avatar] unexpected failure", error instanceof Error ? error.name : typeof error);
    return failure("INTERNAL_ERROR", 500);
  }
}
