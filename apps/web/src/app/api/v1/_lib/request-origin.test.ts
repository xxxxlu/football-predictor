import { describe, expect, it } from "vitest";
import { AuthError } from "@football-predictor/domain";
import { assertSameOrigin, isSameOrigin } from "./request-origin.js";

function build(url: string, headers: Record<string, string>) {
  return new Request(url, { method: "POST", headers });
}

describe("same-origin request guard", () => {
  it("treats a request with no Origin header as same-origin", () => {
    expect(isSameOrigin(build("https://example.test/api", {}))).toBe(true);
  });

  it("matches the browser Host header instead of Next's canonical request URL", () => {
    // Next reports request.url on localhost even when the browser used 127.0.0.1.
    const request = build("http://localhost:3001/api", { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001" });
    expect(isSameOrigin(request)).toBe(true);
  });

  it("honors a trusted x-forwarded-host / x-forwarded-proto pair behind a proxy", () => {
    const request = build("http://internal:3000/api", {
      host: "internal:3000",
      "x-forwarded-host": "app.example.com",
      "x-forwarded-proto": "https",
      origin: "https://app.example.com",
    });
    expect(isSameOrigin(request)).toBe(true);
  });

  it("rejects a genuinely cross-origin request", () => {
    const request = build("https://app.example.com/api", { host: "app.example.com", origin: "https://evil.example.com" });
    expect(isSameOrigin(request)).toBe(false);
  });

  it("assertSameOrigin throws INVALID_ORIGIN for a cross-origin request", () => {
    const request = build("https://app.example.com/api", { host: "app.example.com", origin: "https://evil.example.com" });
    expect(() => assertSameOrigin(request)).toThrowError(AuthError);
    try {
      assertSameOrigin(request);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe("INVALID_ORIGIN");
      expect((error as AuthError).status).toBe(403);
    }
  });

  it("assertSameOrigin passes silently for a same-origin request", () => {
    const request = build("http://localhost:3001/api", { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001" });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });
});
