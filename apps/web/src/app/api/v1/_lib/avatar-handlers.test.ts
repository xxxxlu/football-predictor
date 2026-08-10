import { AVATAR_MAX_UPLOAD_BYTES, AvatarStorageError } from "@pulse/domain";
import { OperationError } from "@pulse/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AvatarImageError } from "@/features/avatar/image-pipeline";
import type { AvatarService } from "@/features/avatar/avatar-service";
import { createAvatarHandlers } from "./avatar-handlers.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PUBLIC_ID = "22222222-2222-4222-8222-222222222222";

const identity = { authenticate: vi.fn(async () => ({ id: USER_ID }) as { id: string } | null) };

const service = {
  getAvatar: vi.fn(async () => null),
  readMedia: vi.fn(async () => ({ body: new Uint8Array([1, 2, 3, 4]), contentType: "image/webp" })),
  upload: vi.fn(async () => ({ avatarUrl: `/api/v1/media/avatars/${PUBLIC_ID}/1.webp`, avatarVersion: 1 })),
  remove: vi.fn(async () => ({ removed: true })),
  sweepPendingObjects: vi.fn(async () => ({ swept: 0, failed: 0 })),
};

const handlers = () => createAvatarHandlers(identity, service as unknown as AvatarService);

function multipart(file: File | null, overrides: { origin?: string | null; cookie?: string | null; contentLength?: string } = {}) {
  const form = new FormData();
  if (file) form.set("avatar", file);
  const headers = new Headers();
  if (overrides.cookie !== null) headers.set("cookie", overrides.cookie ?? "fp_session=test-session");
  if (overrides.origin !== null) headers.set("origin", overrides.origin ?? "https://pulse.test");
  headers.set("host", "pulse.test");
  if (overrides.contentLength) headers.set("content-length", overrides.contentLength);
  return new Request("https://pulse.test/api/v1/account/avatar", { method: "POST", headers, body: form });
}

const photo = (bytes = 32, type = "image/jpeg") => new File([new Uint8Array(bytes)], "IMG_2026_holiday_beach.JPG", { type });

const body = async (response: Response) => (await response.json()) as { data?: unknown; error?: { code: string; message: string } };

describe("POST /api/v1/account/avatar — gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identity.authenticate.mockResolvedValue({ id: USER_ID });
  });

  it("rejects an unauthenticated upload with 401 and never calls the service", async () => {
    identity.authenticate.mockResolvedValue(null);
    const response = await handlers().upload(multipart(photo()));
    expect(response.status).toBe(401);
    expect((await body(response)).error?.code).toBe("UNAUTHENTICATED");
    expect(service.upload).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin write with 403 before authenticating", async () => {
    const response = await handlers().upload(multipart(photo(), { origin: "https://evil.test" }));
    expect(response.status).toBe(403);
    expect((await body(response)).error?.code).toBe("INVALID_ORIGIN");
    expect(identity.authenticate).not.toHaveBeenCalled();
    expect(service.upload).not.toHaveBeenCalled();
  });

  it("refuses an oversized declared body before parsing it", async () => {
    const response = await handlers().upload(multipart(photo(), { contentLength: String(AVATAR_MAX_UPLOAD_BYTES * 40) }));
    expect(response.status).toBe(413);
    expect((await body(response)).error?.code).toBe("FILE_TOO_LARGE");
    expect(service.upload).not.toHaveBeenCalled();
  });

  it("refuses a JSON body: the endpoint is multipart, never base64", async () => {
    const request = new Request("https://pulse.test/api/v1/account/avatar", {
      method: "POST",
      headers: { cookie: "fp_session=test-session", origin: "https://pulse.test", host: "pulse.test", "content-type": "application/json" },
      body: JSON.stringify({ dataUrl: "data:image/png;base64,AAAA" }),
    });
    const response = await handlers().upload(request);
    expect(response.status).toBe(415);
    expect(service.upload).not.toHaveBeenCalled();
  });

  it("refuses a request with no file part", async () => {
    const response = await handlers().upload(multipart(null));
    expect(response.status).toBe(422);
    expect((await body(response)).error?.code).toBe("INVALID_REQUEST");
  });

  it("refuses an oversized file part even when the header lied", async () => {
    const response = await handlers().upload(multipart(photo(AVATAR_MAX_UPLOAD_BYTES + 1), { contentLength: "10" }));
    expect(response.status).toBe(413);
    expect(service.upload).not.toHaveBeenCalled();
  });

  it("pre-filters declared SVG and GIF types", async () => {
    for (const type of ["image/svg+xml", "image/gif", "text/html"]) {
      const response = await handlers().upload(multipart(photo(64, type)));
      expect(response.status).toBe(422);
      expect((await body(response)).error?.code).toBe("UNSUPPORTED_IMAGE_TYPE");
    }
    expect(service.upload).not.toHaveBeenCalled();
  });

  it("passes a spoofed MIME through to the decoder rather than trusting it", async () => {
    // Declared image/png, actually anything: the handler's job is only to hand
    // the bytes over — the pipeline is what decides, and its refusal is mapped.
    service.upload.mockRejectedValueOnce(new AvatarImageError("UNSUPPORTED_IMAGE_TYPE"));
    const response = await handlers().upload(multipart(photo(64, "image/png")));
    expect(service.upload).toHaveBeenCalledOnce();
    expect(response.status).toBe(422);
    expect((await body(response)).error?.code).toBe("UNSUPPORTED_IMAGE_TYPE");
  });
});

describe("POST /api/v1/account/avatar — responses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identity.authenticate.mockResolvedValue({ id: USER_ID });
  });

  it("returns only the avatar pair and never the original filename", async () => {
    const response = await handlers().upload(multipart(photo()));
    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload.data).toEqual({ avatarUrl: `/api/v1/media/avatars/${PUBLIC_ID}/1.webp`, avatarVersion: 1 });
    expect(JSON.stringify(payload)).not.toContain("IMG_2026_holiday_beach");
  });

  it("surfaces the consent and quota refusals with their stable codes", async () => {
    service.upload.mockRejectedValueOnce(new OperationError("PHOTO_CONSENT_REVOKED", 403));
    expect((await handlers().upload(multipart(photo()))).status).toBe(403);

    service.upload.mockRejectedValueOnce(new OperationError("RATE_LIMITED", 429));
    const limited = await handlers().upload(multipart(photo()));
    expect(limited.status).toBe(429);
    expect((await body(limited)).error?.code).toBe("RATE_LIMITED");
  });

  it("collapses storage failures to an opaque 503 with no bucket detail", async () => {
    service.upload.mockRejectedValueOnce(new AvatarStorageError("STORAGE_UPLOAD_FAILED"));
    const response = await handlers().upload(multipart(photo()));
    expect(response.status).toBe(503);
    const payload = await body(response);
    expect(payload.error?.code).toBe("AVATAR_STORAGE_FAILED");
    expect(JSON.stringify(payload)).not.toMatch(/cloud:\/\/|avatars\/|secret|tcb|cos\./i);
  });

  it("never leaks a database error message into the envelope", async () => {
    service.upload.mockRejectedValueOnce(new Error('insert into "identity"."user_avatars" failed: duplicate key at 10.0.0.4:5432'));
    const response = await handlers().upload(multipart(photo()));
    expect(response.status).toBe(500);
    const payload = await body(response);
    expect(payload.error?.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(payload)).not.toMatch(/user_avatars|10\.0\.0\.4|duplicate key/);
  });
});

describe("DELETE /api/v1/account/avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identity.authenticate.mockResolvedValue({ id: USER_ID });
  });

  const del = (origin = "https://pulse.test") =>
    new Request("https://pulse.test/api/v1/account/avatar", {
      method: "DELETE",
      headers: { cookie: "fp_session=test-session", origin, host: "pulse.test" },
    });

  it("requires a session and a same-origin request", async () => {
    identity.authenticate.mockResolvedValueOnce(null);
    expect((await handlers().remove(del())).status).toBe(401);
    expect((await handlers().remove(del("https://evil.test"))).status).toBe(403);
    expect(service.remove).not.toHaveBeenCalled();
  });

  it("is idempotent: deleting nothing is a success", async () => {
    service.remove.mockResolvedValueOnce({ removed: false });
    const response = await handlers().remove(del());
    expect(response.status).toBe(200);
    expect((await body(response)).data).toEqual({ removed: false });
  });
});

describe("GET /api/v1/media/avatars/{publicId}/{version}.webp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identity.authenticate.mockResolvedValue({ id: USER_ID });
  });

  const get = (headers: Record<string, string> = {}) =>
    new Request(`https://pulse.test/api/v1/media/avatars/${PUBLIC_ID}/1.webp`, {
      headers: { cookie: "fp_session=test-session", ...headers },
    });

  it("requires a session", async () => {
    identity.authenticate.mockResolvedValueOnce(null);
    const response = await handlers().media(get(), PUBLIC_ID, "1.webp");
    expect(response.status).toBe(401);
    expect(service.readMedia).not.toHaveBeenCalled();
  });

  it("streams the bytes with an immutable, private cache and nosniff", async () => {
    const response = await handlers().media(get(), PUBLIC_ID, "1.webp");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, max-age=604800, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("etag")).toBe(`"avatar-${PUBLIC_ID}-1"`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("honours If-None-Match with a 304", async () => {
    const response = await handlers().media(get({ "if-none-match": `"avatar-${PUBLIC_ID}-1"` }), PUBLIC_ID, "1.webp");
    expect(response.status).toBe(304);
    expect(service.readMedia).not.toHaveBeenCalled();
  });

  it("404s on a traversal attempt or a malformed id, without hitting storage", async () => {
    for (const [id, file] of [
      ["../../etc", "1.webp"],
      [PUBLIC_ID, "1.png"],
      [PUBLIC_ID, "0.webp"],
      [PUBLIC_ID, "../../secret.webp"],
      ["not-a-uuid", "1.webp"],
    ] as const) {
      const response = await handlers().media(get(), id, file);
      expect(response.status).toBe(404);
    }
    expect(service.readMedia).not.toHaveBeenCalled();
  });

  it("404s for an avatar that is gone", async () => {
    service.readMedia.mockResolvedValueOnce(null as never);
    expect((await handlers().media(get(), PUBLIC_ID, "1.webp")).status).toBe(404);
  });
});
