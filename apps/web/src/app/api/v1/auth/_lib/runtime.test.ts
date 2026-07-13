import { describe, expect, it } from "vitest";
import { createPasswordHasher, createTokenFactory } from "./runtime.js";

describe("identity cryptography", () => {
  it("uses Argon2id for passwords", async () => {
    const hasher = createPasswordHasher();
    const hash = await hasher.hash("correct-horse-123");
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(hasher.verify(hash, "correct-horse-123")).resolves.toBe(true);
    await expect(hasher.verify(hash, "wrong-password-123")).resolves.toBe(false);
  });

  it("creates high-entropy opaque values and stores only deterministic hashes", () => {
    const tokens = createTokenFactory();
    const session = tokens.sessionToken();
    const recovery = tokens.recoveryCode();
    expect(session.length).toBeGreaterThanOrEqual(43);
    expect(recovery).toMatch(/^FP-[A-Z2-9]{4}(?:-[A-Z2-9]{4}){7}$/);
    expect(tokens.hash(session)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokens.hash(session)).not.toContain(session);
  });
});
