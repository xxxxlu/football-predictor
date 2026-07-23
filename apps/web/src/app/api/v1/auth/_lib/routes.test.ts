import { describe, expect, it } from "vitest";
import { usesSecureSessionCookie } from "./routes.js";

describe("session cookie environment policy", () => {
  it("uses Secure cookies for the production HTTPS deployment (APP_ENV=production)", () => {
    expect(usesSecureSessionCookie("production")).toBe(true);
  });

  it("lets CI's production-build E2E server hand out the cookie over http (APP_ENV=test)", () => {
    expect(usesSecureSessionCookie("test")).toBe(false);
  });

  it("allows a local HTTP development preview to receive the session cookie (APP_ENV=development)", () => {
    expect(usesSecureSessionCookie("development")).toBe(false);
  });

  it("stays non-Secure when APP_ENV is not set at all", () => {
    expect(usesSecureSessionCookie(undefined)).toBe(false);
  });
});
