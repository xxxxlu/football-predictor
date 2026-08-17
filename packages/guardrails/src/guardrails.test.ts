import { describe, expect, it } from "vitest";
import { createCapabilityModel } from "./capabilities.js";
import { DecimalError, isPositiveDecimal, multiplyByDecimal } from "./decimal.js";
import { createKeyRedactor, DEFAULT_REDACTION_MARKER } from "./redact.js";
import { isSameOrigin } from "./same-origin.js";

/**
 * These cover the surface the extraction *added* — the options this repository's
 * own callers do not pass. Everything the app already exercises is covered by the
 * app's suites; what had no coverage until now is the generic behaviour someone
 * reusing these would depend on first.
 */

describe("multiplyByDecimal", () => {
  it("is exact where floating point is not", () => {
    // 1000 * 2.1 is 2100.0000000000002 in binary floating point.
    expect(multiplyByDecimal(1000, "2.1")).toBe(2100);
    // 3 * 1.005 = 3.015; Number(3 * 1.005) is 3.0149999999999997 and rounds down.
    expect(multiplyByDecimal(3, "1.005")).toBe(3);
    expect(multiplyByDecimal(200, "1.005")).toBe(201);
  });

  it("rounds half up, once, at the end", () => {
    expect(multiplyByDecimal(1, "2.5")).toBe(3);
    expect(multiplyByDecimal(1, "2.4")).toBe(2);
    expect(multiplyByDecimal(5, "1.05")).toBe(5);
    expect(multiplyByDecimal(10, "1.05")).toBe(11);
  });

  it("carries arbitrary precision instead of losing it", () => {
    expect(multiplyByDecimal(1, "1.000000000000000001")).toBe(1);
    expect(multiplyByDecimal(10 ** 15, "1.000000000000001")).toBe(1_000_000_000_000_001);
  });

  it("refuses rather than returning a wrong number", () => {
    for (const bad of ["", "abc", "-1.5", "1.", ".5", "1e3", "01.5", "0", "0.00"]) {
      expect(() => multiplyByDecimal(100, bad)).toThrow(DecimalError);
    }
    for (const bad of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => multiplyByDecimal(bad, "2.0")).toThrow(DecimalError);
    }
    expect(() => multiplyByDecimal(Number.MAX_SAFE_INTEGER, "2.0")).toThrow(DecimalError);
  });

  it("accepts zero as a multiplicand but never as a rate", () => {
    expect(multiplyByDecimal(0, "2.5")).toBe(0);
    expect(isPositiveDecimal("0")).toBe(false);
    expect(isPositiveDecimal("0.0")).toBe(false);
    expect(isPositiveDecimal("0.5")).toBe(true);
  });
});

describe("isSameOrigin", () => {
  const request = (url: string, headers: Record<string, string>) => new Request(url, { headers });

  it("compares against the forwarded host, not the request URL", () => {
    // The case the naive `new URL(request.url).origin` gets wrong.
    expect(isSameOrigin(request("https://localhost/api", {
      origin: "https://app.example.com",
      "x-forwarded-host": "app.example.com",
      "x-forwarded-proto": "https",
    }))).toBe(true);
  });

  it("falls back to the request URL when no host is stated at all", () => {
    expect(isSameOrigin(request("https://pulse.test/api", { origin: "https://pulse.test" }))).toBe(true);
    expect(isSameOrigin(request("https://pulse.test/api", { origin: "https://evil.test" }))).toBe(false);
  });

  it("treats a missing Origin as same-origin by default and rejects it on request", () => {
    const bare = request("https://pulse.test/api", {});
    expect(isSameOrigin(bare)).toBe(true);
    expect(isSameOrigin(bare, { missingOrigin: "reject" })).toBe(false);
  });

  it("refuses a forwarded host that is not on the allowlist", () => {
    const spoofed = request("https://pulse.test/api", {
      origin: "https://evil.test",
      "x-forwarded-host": "evil.test",
      "x-forwarded-proto": "https",
    });
    // Believed without a list — the behaviour that makes the list worth setting.
    expect(isSameOrigin(spoofed)).toBe(true);
    expect(isSameOrigin(spoofed, { trustedHosts: ["pulse.test"] })).toBe(false);
    // And an off-list forwarded host does not quietly fall through to `Host`.
    expect(isSameOrigin(request("https://pulse.test/api", {
      origin: "https://pulse.test",
      host: "pulse.test",
      "x-forwarded-host": "evil.test",
    }), { trustedHosts: ["pulse.test"] })).toBe(false);
  });
});

describe("createKeyRedactor", () => {
  it("matches secret words anywhere but location words only whole", () => {
    const redact = createKeyRedactor({ substrings: ["token"], words: ["ip"] });
    expect(redact({ refreshToken: "x", reporterIpAddress: "1.2.3.4", description: "ships in a zip" })).toEqual({
      refreshToken: DEFAULT_REDACTION_MARKER,
      reporterIpAddress: DEFAULT_REDACTION_MARKER,
      // `ip` occurs inside both words and must not trigger.
      description: "ships in a zip",
    });
  });

  it("reaches nested objects and arrays, and takes a custom marker", () => {
    const redact = createKeyRedactor({ substrings: ["secret"], marker: "***" });
    expect(redact({ a: [{ secret: 1 }, { keep: 2 }], b: { c: { secretValue: 3 } } })).toEqual({
      a: [{ secret: "***" }, { keep: 2 }],
      b: { c: { secretValue: "***" } },
    });
  });

  it("passes primitives and null through untouched", () => {
    const redact = createKeyRedactor({ substrings: ["secret"] });
    for (const value of [null, 1, "text", true, undefined]) expect(redact(value)).toBe(value);
  });

  it("treats pattern characters as literals, not as regex", () => {
    const redact = createKeyRedactor({ substrings: ["a.c"] });
    expect(redact({ "a.c": 1, abc: 2 })).toEqual({ "a.c": DEFAULT_REDACTION_MARKER, abc: 2 });
  });
});

describe("createCapabilityModel", () => {
  const model = createCapabilityModel<"ADMIN" | "MOD" | "GUEST", "READ" | "WRITE" | "PURGE">({
    roleCapabilities: { ADMIN: ["READ", "WRITE", "PURGE"], MOD: ["READ", "WRITE"], GUEST: [] },
    reauthRequired: ["PURGE"],
  });

  it("unions the capabilities of every held role", () => {
    expect([...model.capabilitiesFor(["MOD", "GUEST"])]).toEqual(["READ", "WRITE"]);
    expect([...model.capabilitiesFor([])]).toEqual([]);
    expect(model.capabilitiesFor(["ADMIN"]).has("PURGE")).toBe(true);
  });

  it("answers per capability, never per role", () => {
    expect(model.hasCapability(["MOD"], "WRITE")).toBe(true);
    expect(model.hasCapability(["MOD"], "PURGE")).toBe(false);
    expect(model.hasCapability(["GUEST"], "READ")).toBe(false);
  });

  it("reports which capabilities demand a fresh identity proof", () => {
    expect(model.requiresReauthentication("PURGE")).toBe(true);
    expect(model.requiresReauthentication("WRITE")).toBe(false);
  });
});
