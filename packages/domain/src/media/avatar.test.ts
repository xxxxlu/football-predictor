import { describe, expect, it } from "vitest";

import {
  assertAvatarAuditMetadata,
  avatarAuditMetadata,
  avatarFallbackTone,
  AVATAR_FALLBACK_TONES,
  avatarInitial,
  avatarMediaPath,
  avatarObjectKey,
  avatarProjection,
  avatarRenderPlan,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_OUTPUT_CONTENT_TYPE,
  AVATAR_OUTPUT_EDGE,
  NO_AVATAR,
  parseAvatarMediaPath,
} from "./avatar.js";

const ID = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const OTHER = "9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";

describe("avatar object keys and media paths", () => {
  it("keys are random-id scoped and versioned, never named after the member", () => {
    expect(avatarObjectKey(ID, 3)).toBe(`avatars/${ID}/3.webp`);
    expect(avatarObjectKey(ID, 3)).not.toContain("alice");
  });

  it("refuses a key or path built from anything but a random uuid", () => {
    expect(() => avatarObjectKey("alice", 1)).toThrow(/random uuid/);
    expect(() => avatarMediaPath("../../etc/passwd", 1)).toThrow(/random uuid/);
    expect(() => avatarObjectKey(ID, 0)).toThrow(/positive integer/);
  });

  it("media paths round-trip and reject anything malformed", () => {
    expect(parseAvatarMediaPath(avatarMediaPath(ID, 12))).toEqual({ publicId: ID, version: 12 });
    for (const bad of [
      "/api/v1/media/avatars/alice/1.webp",
      `/api/v1/media/avatars/${ID}/0.webp`,
      `/api/v1/media/avatars/${ID}/1.png`,
      `/api/v1/media/avatars/${ID}/../1.webp`,
    ]) {
      expect(parseAvatarMediaPath(bad)).toBeNull();
    }
  });

  /**
   * The point of the two-identifier design: the URL is built from `publicId`,
   * the bucket path from a *separate* random id. Knowing one tells you nothing
   * about the other, so a served avatar never discloses where its bytes live.
   */
  it("the public path is built from the public id, never from the storage key", () => {
    const path = avatarMediaPath(ID, 1);
    const key = avatarObjectKey(OTHER, 1);
    expect(path.startsWith("/api/v1/media/avatars/")).toBe(true);
    expect(path).not.toContain(OTHER);
    expect(path).not.toContain(key);
    expect(path).not.toContain("cloud://");
    expect(key).not.toContain(ID);
  });
});

describe("avatarProjection", () => {
  it("builds exactly two fields and nothing else", () => {
    const projection = avatarProjection({ avatarPublicId: ID, avatarVersion: 4 });
    expect(Object.keys(projection).sort()).toEqual(["avatarUrl", "avatarVersion"]);
    expect(projection).toEqual({ avatarUrl: `/api/v1/media/avatars/${ID}/4.webp`, avatarVersion: 4 });
  });

  it("degrades to the no-avatar pair for every partial or absent row", () => {
    for (const row of [null, undefined, {}, { avatarPublicId: ID }, { avatarVersion: 4 }, { avatarPublicId: ID, avatarVersion: 0 }]) {
      expect(avatarProjection(row as never)).toEqual(NO_AVATAR);
    }
  });

  it("accepts the numeric string postgres hands back for integers", () => {
    expect(avatarProjection({ avatarPublicId: ID, avatarVersion: "7" })).toEqual({
      avatarUrl: `/api/v1/media/avatars/${ID}/7.webp`,
      avatarVersion: 7,
    });
  });
});

describe("default avatar fallback", () => {
  it("prefers the nickname, falls back to the PULSE ID, then to a glyph", () => {
    expect(avatarInitial("Alice", "pulse-1")).toBe("A");
    expect(avatarInitial(null, "bob")).toBe("B");
    expect(avatarInitial("  ", null)).toBe("#");
    expect(avatarInitial(null, null)).toBe("#");
  });

  it("skips punctuation and handles non-latin names", () => {
    expect(avatarInitial("@lu", null)).toBe("L");
    expect(avatarInitial("小鹿", null)).toBe("小");
    expect(avatarInitial("...", "zed")).toBe("Z");
  });

  it("tones are deterministic and stay inside the palette", () => {
    for (const seed of ["alice", "bob", "小鹿", "", null]) {
      const tone = avatarFallbackTone(seed);
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(AVATAR_FALLBACK_TONES);
    }
    expect(avatarFallbackTone("alice")).toBe(avatarFallbackTone("alice"));
  });
});

describe("avatarRenderPlan", () => {
  const url = avatarMediaPath(ID, 1);

  it("renders the image when there is one and it loaded", () => {
    expect(avatarRenderPlan({ src: url, nickname: "Alice", pulseId: "alice", size: 40 })).toMatchObject({ mode: "image", box: 40 });
  });

  it("falls back to initials when the account has no avatar", () => {
    expect(avatarRenderPlan({ src: null, nickname: "Alice", pulseId: "alice" })).toMatchObject({ mode: "initials", initial: "A" });
    expect(avatarRenderPlan({ nickname: null, pulseId: "bob" })).toMatchObject({ mode: "initials", initial: "B" });
  });

  it("falls back to initials when the image fails to load, never to a broken glyph", () => {
    const plan = avatarRenderPlan({ src: url, failed: true, nickname: "Alice", pulseId: "alice" });
    expect(plan.mode).toBe("initials");
    expect(plan.initial).toBe("A");
  });

  it("reserves the same box in both branches, so a missing photo cannot reflow a row", () => {
    for (const size of [24, 32, 36, 40, 56, 96]) {
      expect(avatarRenderPlan({ src: url, size }).box).toBe(size);
      expect(avatarRenderPlan({ src: null, size }).box).toBe(size);
      expect(avatarRenderPlan({ src: url, failed: true, size }).box).toBe(size);
    }
  });

  it("keeps an account's tone identical across surfaces and across the two branches", () => {
    const withPhoto = avatarRenderPlan({ src: url, pulseId: "alice", nickname: "Alice", size: 96 });
    const withoutPhoto = avatarRenderPlan({ src: null, pulseId: "alice", nickname: "Alice", size: 24 });
    expect(withPhoto.tone).toBe(withoutPhoto.tone);
    expect(withPhoto.tone).toBeLessThan(AVATAR_FALLBACK_TONES);
  });
});

describe("avatar audit metadata", () => {
  it("records only size, type, dimensions, version and time", () => {
    const metadata = avatarAuditMetadata({ byteSize: 1024, width: 512, height: 512, version: 2, uploadedAt: new Date("2026-08-07T00:00:00.000Z") });
    expect(Object.keys(metadata).sort()).toEqual(["avatarVersion", "byteSize", "contentType", "height", "kind", "uploadedAt", "width"]);
    expect(metadata.contentType).toBe(AVATAR_OUTPUT_CONTENT_TYPE);
    expect(metadata.uploadedAt).toBe("2026-08-07T00:00:00.000Z");
  });

  it("throws loud if anyone ever tries to persist the image or its provenance", () => {
    for (const key of ["dataUrl", "data_url", "base64", "payload", "bytes", "buffer", "exif", "gps", "latitude", "longitude", "fileName", "originalName", "deviceModel"]) {
      expect(() => assertAvatarAuditMetadata({ kind: "AVATAR_UPLOADED", [key]: "x" })).toThrow(/must never carry/);
    }
  });

  it("scans nested values, not just the top level", () => {
    expect(() => assertAvatarAuditMetadata({ kind: "AVATAR_UPLOADED", extra: { nested: { exif: {} } } })).toThrow(/must never carry "exif"/);
  });
});

describe("policy constants", () => {
  it("pins the envelope the API and the pipeline both rely on", () => {
    expect(AVATAR_MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
    expect(AVATAR_OUTPUT_EDGE).toBe(512);
    expect(AVATAR_OUTPUT_CONTENT_TYPE).toBe("image/webp");
  });
});
