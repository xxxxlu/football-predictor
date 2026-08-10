import { AvatarStorageError, type AvatarStorage } from "@pulse/domain";
import { OperationError, type AvatarRecord, type AvatarRepository, type PendingAvatarObject } from "@pulse/db";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { avatarErrorResponse, createAvatarService, type PhotoConsentStore } from "./avatar-service";
import { AvatarImageError } from "./image-pipeline";

/**
 * The service is the only place where two stores have to agree, so these tests
 * drive fakes and assert on the *ordering* guarantees rather than on SQL: quota
 * before work, new key never overwriting the live one, compensating delete when
 * the row write fails, predecessor retired only after the row commits.
 */

/** Deterministic but never-colliding stand-in for randomUUID. */
function uuidSequence() {
  let counter = 0;
  return () => {
    counter += 1;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  };
}
const ABSENT_PUBLIC_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function samplePhoto(width = 600, height = 600): Promise<Uint8Array> {
  const buffer = await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 220 } } })
    .jpeg()
    .toBuffer();
  return new Uint8Array(buffer);
}

function fakeRepository() {
  const state: { record: AvatarRecord | null; quotaUsed: number; queue: PendingAvatarObject[]; deleted: string[] } = {
    record: null,
    quotaUsed: 0,
    queue: [],
    deleted: [],
  };
  const control = { quotaLimit: 5, failSave: null as Error | null };
  const repository = {
    getAvatar: vi.fn(async () => state.record),
    getServableAvatar: vi.fn(async (publicId: string, version: number) =>
      state.record && state.record.publicId === publicId && state.record.version === version ? state.record : null,
    ),
    consumeAvatarChangeQuota: vi.fn(async () => {
      if (state.quotaUsed >= control.quotaLimit) throw new OperationError("RATE_LIMITED", 429);
      state.quotaUsed += 1;
    }),
    saveAvatar: vi.fn(async (input: Parameters<AvatarRepository["saveAvatar"]>[0]) => {
      if (control.failSave) throw control.failSave;
      const previous = state.record;
      const record: AvatarRecord = {
        userId: input.userId,
        publicId: input.publicId,
        fileId: input.fileId,
        objectKey: input.objectKey,
        contentType: input.contentType,
        byteSize: input.byteSize,
        width: input.width,
        height: input.height,
        version: (previous?.version ?? 0) + 1,
        moderationStatus: "APPROVED",
      };
      state.record = record;
      const replaced = previous ? { objectKey: previous.objectKey, fileId: previous.fileId } : null;
      if (replaced) state.queue.push(replaced);
      return { record, replaced };
    }),
    deleteAvatar: vi.fn(async () => {
      const previous = state.record;
      state.record = null;
      if (!previous) return { removed: false, object: null };
      const object = { objectKey: previous.objectKey, fileId: previous.fileId };
      state.queue.push(object);
      return { removed: true, object };
    }),
    listPendingAvatarObjects: vi.fn(async (limit = 50) => state.queue.slice(0, limit)),
    markAvatarObjectDeleted: vi.fn(async (objectKey: string) => {
      state.queue = state.queue.filter((entry) => entry.objectKey !== objectKey);
      state.deleted.push(objectKey);
    }),
    recordAvatarObjectDeleteFailure: vi.fn(async () => {}),
  };
  return { repository: repository as unknown as AvatarRepository, state, control, spies: repository };
}

function fakeStorage() {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  const control = { failPut: false, failRemove: false };
  const calls: string[] = [];
  const storage: AvatarStorage = {
    put: async ({ objectKey, body, contentType }) => {
      calls.push(`put:${objectKey}`);
      if (control.failPut) throw new AvatarStorageError("STORAGE_UPLOAD_FAILED");
      objects.set(objectKey, { body, contentType });
      return { fileId: `cloud://env/${objectKey}` };
    },
    remove: async ({ objectKey }) => {
      calls.push(`remove:${objectKey}`);
      if (control.failRemove) throw new AvatarStorageError("STORAGE_DELETE_FAILED");
      objects.delete(objectKey);
    },
    temporaryUrl: async () => "https://example.invalid/temporary",
    read: async ({ objectKey }) => {
      const object = objects.get(objectKey);
      if (!object) throw new AvatarStorageError("STORAGE_READ_FAILED");
      return object;
    },
  };
  return { storage, objects, control, calls };
}

function fakePrivacy(initial: Array<{ dataType: string; consented: boolean }> = []) {
  const consents = [...initial];
  const stored: Array<{ dataType: string; data: unknown }> = [];
  const privacy: PhotoConsentStore = {
    listConsent: async () => consents,
    upsertConsent: async (_userId, dataType, consented) => {
      const existing = consents.find((entry) => entry.dataType === dataType);
      if (existing) existing.consented = consented;
      else consents.push({ dataType, consented });
      return null;
    },
    storeCollectedData: async (_userId, dataType, data) => {
      stored.push({ dataType, data });
      return null;
    },
  };
  return { privacy, consents, stored };
}

function build(overrides: { privacy?: ReturnType<typeof fakePrivacy> } = {}) {
  const repo = fakeRepository();
  const store = fakeStorage();
  const privacy = overrides.privacy ?? fakePrivacy();
  const service = createAvatarService({
    repository: repo.repository,
    storage: store.storage,
    privacy: privacy.privacy,
    clock: () => new Date("2026-08-07T10:00:00.000Z"),
    newId: uuidSequence(),
  });
  return { service, repo, store, privacy };
}

const USER = "user-1";

describe("avatar upload — happy path", () => {
  it("stores one re-encoded object and returns only the public pair", async () => {
    const { service, store } = build();
    const summary = await service.upload(USER, await samplePhoto());

    expect(Object.keys(summary).sort()).toEqual(["avatarUrl", "avatarVersion"]);
    expect(summary.avatarVersion).toBe(1);
    expect(summary.avatarUrl).toMatch(/^\/api\/v1\/media\/avatars\/[0-9a-f-]{36}\/1\.webp$/);

    const [[key, object]] = [...store.objects.entries()];
    expect(key).toMatch(/^avatars\/[0-9a-f-]{36}\/1\.webp$/);
    expect(object!.contentType).toBe("image/webp");
    // The stored bytes are the pipeline's output, not the JPEG that came in.
    expect(await sharp(Buffer.from(object!.body)).metadata()).toMatchObject({ format: "webp", width: 512, height: 512 });
  });

  it("writes a metadata-only privacy note and never the image", async () => {
    const { service, privacy } = build();
    await service.upload(USER, await samplePhoto());

    expect(privacy.stored).toHaveLength(1);
    const note = privacy.stored[0]!;
    expect(note.dataType).toBe("PHOTO");
    expect(Object.keys(note.data as object).sort()).toEqual([
      "avatarVersion",
      "byteSize",
      "contentType",
      "height",
      "kind",
      "uploadedAt",
      "width",
    ]);
    expect(JSON.stringify(note.data)).not.toMatch(/base64|dataUrl|exif|gps|fileName/i);
  });

  it("a replacement uploads to a NEW key, keeps the public id, and retires the old object", async () => {
    const { service, store, repo } = build();
    const first = await service.upload(USER, await samplePhoto());
    const firstKey = [...store.objects.keys()][0]!;

    const second = await service.upload(USER, await samplePhoto(700, 700));
    expect(second.avatarVersion).toBe(2);
    // Same public id → the media URL only changes in its version segment.
    expect(second.avatarUrl.replace("/2.webp", "")).toBe(first.avatarUrl.replace("/1.webp", ""));

    expect(store.objects.has(firstKey)).toBe(false);
    expect([...store.objects.keys()]).toHaveLength(1);
    expect(repo.state.deleted).toEqual([firstKey]);
    // put happened before any remove: the live object is never overwritten.
    expect(store.calls[0]!.startsWith("put:")).toBe(true);
  });
});

describe("avatar upload — cross-store failure handling", () => {
  it("a storage failure leaves the database untouched", async () => {
    const { service, store, repo } = build();
    store.control.failPut = true;

    await expect(service.upload(USER, await samplePhoto())).rejects.toBeInstanceOf(AvatarStorageError);
    expect(repo.spies.saveAvatar).not.toHaveBeenCalled();
    expect(repo.state.record).toBeNull();
    // The attempt still cost its quota unit.
    expect(repo.state.quotaUsed).toBe(1);
  });

  it("a database failure deletes the object that was just uploaded", async () => {
    const { service, store, repo } = build();
    repo.control.failSave = new OperationError("AVATAR_SAVE_FAILED", 500);

    await expect(service.upload(USER, await samplePhoto())).rejects.toMatchObject({ code: "AVATAR_SAVE_FAILED" });
    expect(store.objects.size).toBe(0);
    expect(store.calls.some((call) => call.startsWith("remove:"))).toBe(true);
  });

  it("a failed retire defers to the sweeper instead of failing a published upload", async () => {
    const { service, store, repo } = build();
    await service.upload(USER, await samplePhoto());
    store.control.failRemove = true;

    const second = await service.upload(USER, await samplePhoto(700, 700));
    expect(second.avatarVersion).toBe(2);
    expect(repo.spies.recordAvatarObjectDeleteFailure).toHaveBeenCalledTimes(1);

    store.control.failRemove = false;
    await expect(service.sweepPendingObjects()).resolves.toEqual({ swept: 1, failed: 0 });
  });
});

describe("avatar quota", () => {
  it("prices every attempt, so a rejected file still consumes a unit", async () => {
    const { service, repo } = build();
    const notAnImage = new Uint8Array(Buffer.from("%PDF-1.7"));
    await expect(service.upload(USER, notAnImage)).rejects.toBeInstanceOf(AvatarImageError);
    expect(repo.state.quotaUsed).toBe(1);
  });

  it("refuses past the limit and cannot be beaten by concurrency", async () => {
    const { service, repo, store } = build();
    repo.control.quotaLimit = 5;
    const photo = await samplePhoto();

    const results = await Promise.allSettled(Array.from({ length: 8 }, () => service.upload(USER, photo)));
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(3);
    for (const result of rejected) {
      expect((result as PromiseRejectedResult).reason).toMatchObject({ code: "RATE_LIMITED", status: 429 });
    }
    // The quota is consumed exactly `limit` times regardless of interleaving.
    expect(repo.state.quotaUsed).toBe(5);
    expect(store.objects.size).toBeGreaterThan(0);
  });
});

describe("PHOTO consent", () => {
  it("an explicit revocation blocks the upload without touching the current avatar", async () => {
    const revoked = fakePrivacy([{ dataType: "PHOTO", consented: false }]);
    const { service, repo, store } = build({ privacy: revoked });
    repo.state.record = {
      userId: USER,
      publicId: ABSENT_PUBLIC_ID,
      fileId: "cloud://env/live",
      objectKey: `avatars/${ABSENT_PUBLIC_ID}/1.webp`,
      contentType: "image/webp",
      byteSize: 1000,
      width: 512,
      height: 512,
      version: 1,
      moderationStatus: "APPROVED",
    };

    await expect(service.upload(USER, await samplePhoto())).rejects.toMatchObject({ code: "PHOTO_CONSENT_REVOKED", status: 403 });
    // Not deleted, not even a quota unit: the request never became an attempt.
    expect(repo.state.record).not.toBeNull();
    expect(repo.state.quotaUsed).toBe(0);
    expect(store.calls).toEqual([]);
  });

  it("a first upload records consent through the confirm action itself", async () => {
    const fresh = fakePrivacy();
    const { service } = build({ privacy: fresh });
    await service.upload(USER, await samplePhoto());
    expect(fresh.consents).toEqual([{ dataType: "PHOTO", consented: true }]);
  });
});

describe("avatar delete and media read", () => {
  let harness: ReturnType<typeof build>;
  beforeEach(() => {
    harness = build();
  });

  it("is idempotent and removes the object", async () => {
    const { service, store, repo } = harness;
    await service.upload(USER, await samplePhoto());
    expect(store.objects.size).toBe(1);

    await expect(service.remove(USER)).resolves.toEqual({ removed: true });
    expect(store.objects.size).toBe(0);
    expect(repo.state.record).toBeNull();

    await expect(service.remove(USER)).resolves.toEqual({ removed: false });
    await expect(service.remove(USER)).resolves.toEqual({ removed: false });
  });

  it("serves bytes for a live avatar and null for anything else", async () => {
    const { service, repo } = harness;
    const summary = await service.upload(USER, await samplePhoto());
    const publicId = repo.state.record!.publicId;

    const media = await service.readMedia(publicId, summary.avatarVersion);
    expect(media?.contentType).toBe("image/webp");
    expect(media!.body.byteLength).toBeGreaterThan(0);

    expect(await service.readMedia(publicId, 99)).toBeNull();
    expect(await service.readMedia(ABSENT_PUBLIC_ID, 1)).toBeNull();
  });
});

describe("avatarErrorResponse", () => {
  it("maps every failure to a stable code and never leaks internals", () => {
    expect(avatarErrorResponse(new AvatarImageError("FILE_TOO_LARGE"))).toEqual({ code: "FILE_TOO_LARGE", status: 413 });
    expect(avatarErrorResponse(new AvatarImageError("UNSUPPORTED_IMAGE_TYPE"))).toEqual({ code: "UNSUPPORTED_IMAGE_TYPE", status: 422 });
    expect(avatarErrorResponse(new AvatarStorageError("STORAGE_UPLOAD_FAILED"))).toEqual({ code: "AVATAR_STORAGE_FAILED", status: 503 });
    expect(avatarErrorResponse(new AvatarStorageError("STORAGE_NOT_CONFIGURED"))).toEqual({ code: "AVATAR_UNAVAILABLE", status: 503 });
    expect(avatarErrorResponse(new Error("connect ECONNREFUSED 10.0.0.4:5432"))).toBeNull();
  });
});
