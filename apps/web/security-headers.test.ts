import { describe, expect, it } from "vitest";
import { securityHeaders } from "./next.config";

describe("production security headers", () => {
  it("denies framing and sensitive browser capabilities", () => {
    const headers = Object.fromEntries(securityHeaders(true).map(({ key, value }) => [key, value]));
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
    // Player photos / team logos load from the supplier CDN; nothing else may be framed or connected off-origin.
    expect(headers["Content-Security-Policy"]).toContain("img-src 'self' data: blob: https://media.api-sports.io");
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Permissions-Policy"]).toContain("camera=(self)");
    expect(headers["Permissions-Policy"]).toContain("geolocation=(self)");
    expect(headers["Permissions-Policy"]).toContain("microphone=()");
    expect(headers["Permissions-Policy"]).toContain("payment=()");
    expect(headers["Strict-Transport-Security"]).toContain("max-age=31536000");
  });

  it("only emits HSTS in production and permits the Next dev runtime explicitly", () => {
    const headers = Object.fromEntries(securityHeaders(false).map(({ key, value }) => [key, value]));
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
    expect(headers["Content-Security-Policy"]).toContain("'unsafe-eval'");
    expect(headers["Content-Security-Policy"]).toContain("ws:");
  });
});
