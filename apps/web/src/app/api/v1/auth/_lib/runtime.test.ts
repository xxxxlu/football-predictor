import { describe, expect, it } from "vitest";
import { accessContext, createPasswordHasher, createTokenFactory } from "./runtime.js";

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

  it("derives coarse Vercel location and device metadata", () => {
    const context = accessContext(new Request("https://example.test", { headers: { "x-forwarded-for": "203.0.113.8, 10.0.0.1", "x-vercel-ip-country": "IN", "x-vercel-ip-country-region": "MH", "x-vercel-ip-city": "Mumbai", "user-agent": "Mozilla/5.0 (Linux; Android 14; Mobile) Chrome/125.0" } }));
    expect(context).toMatchObject({ ipAddress: "203.0.113.8", countryCode: "IN", region: "MH", city: "Mumbai", deviceClass: "MOBILE", os: "Android", browser: "Chrome" });
  });
});
