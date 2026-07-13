import { describe, expect, it } from "vitest";
import { usesSecureSessionCookie } from "./routes.js";

describe("session cookie environment policy", () => {
  it("uses Secure cookies for the production HTTPS deployment", () => {
    expect(usesSecureSessionCookie("production")).toBe(true);
  });

  it("allows a local HTTP development preview to receive the session cookie", () => {
    expect(usesSecureSessionCookie("development")).toBe(false);
    expect(usesSecureSessionCookie("test")).toBe(false);
  });
});
