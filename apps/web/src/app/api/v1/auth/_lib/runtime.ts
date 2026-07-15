import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { loadIdentityConfig } from "@football-predictor/config";
import { createIdentityDatabase, DrizzleIdentityRepository } from "@football-predictor/db";
import { IdentityService, type AccessContext, type PasswordHasher, type TokenFactory } from "@football-predictor/domain";

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createPasswordHasher(): PasswordHasher {
  return {
    // @node-rs/argon2 defaults to Argon2id; omit its ambient const enum for isolatedModules compatibility.
    hash: (password) => hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 }),
    verify: async (encoded, password) => {
      try { return await verify(encoded, password); } catch { return false; }
    },
  };
}

export function createTokenFactory(): TokenFactory {
  return {
    sessionToken: () => randomBytes(32).toString("base64url"),
    recoveryCode: () => {
      const bytes = randomBytes(32);
      const characters = Array.from(bytes, (byte) => RECOVERY_ALPHABET[byte & 31]).join("");
      return `FP-${characters.match(/.{4}/g)?.join("-") ?? characters}`;
    },
    hash: (value) => createHash("sha256").update(value, "utf8").digest("hex"),
  };
}

declare global {
  var __footballPredictorIdentityService: IdentityService | undefined;
}

export function getIdentityService() {
  if (globalThis.__footballPredictorIdentityService) return globalThis.__footballPredictorIdentityService;
  const config = loadIdentityConfig(process.env);
  const { db } = createIdentityDatabase(config.databaseUrl);
  const service = new IdentityService(
    new DrizzleIdentityRepository(db),
    createPasswordHasher(),
    createTokenFactory(),
    () => new Date(),
    { currentRulesVersion: config.rulesVersion, sessionTtlMs: config.sessionTtlMs },
  );
  globalThis.__footballPredictorIdentityService = service;
  return service;
}

export function sourceKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = forwarded || request.headers.get("x-real-ip") || "unknown";
  return `source:${createHash("sha256").update(raw).digest("hex")}`;
}

export function accessContext(request: Request): AccessContext {
  const ua = clean(request.headers.get("user-agent"), 512);
  const ipAddress = clean(request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip") || "unknown", 64);
  return {
    ipAddress,
    countryCode: header(request, "x-vercel-ip-country", "cf-ipcountry"),
    region: header(request, "x-vercel-ip-country-region", "cf-region-code", "cf-region"),
    city: header(request, "x-vercel-ip-city", "cf-ipcity"),
    timezone: header(request, "x-vercel-ip-timezone", "cf-timezone"),
    userAgent: ua,
    acceptLanguage: clean(request.headers.get("accept-language"), 128),
    deviceClass: deviceClass(ua),
    os: operatingSystem(ua),
    browser: browserFamily(ua),
  };
}

function header(request: Request, ...names: string[]) {
  for (const name of names) {
    const value = request.headers.get(name);
    if (value) { try { return clean(decodeURIComponent(value), 128); } catch { return clean(value, 128); } }
  }
  return "";
}
function clean(value: string | null | undefined, limit: number) { return (value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit); }
function deviceClass(ua: string) { const v = ua.toLowerCase(); return /ipad|tablet/.test(v) ? "TABLET" : /mobile|android|iphone/.test(v) ? "MOBILE" : v ? "DESKTOP" : "OTHER"; }
function operatingSystem(ua: string) { const v = ua.toLowerCase(); return v.includes("android") ? "Android" : /iphone|ipad|ios/.test(v) ? "iOS" : v.includes("windows") ? "Windows" : /mac os|macintosh/.test(v) ? "macOS" : v.includes("linux") ? "Linux" : "Other"; }
function browserFamily(ua: string) { const v = ua.toLowerCase(); return v.includes("edg/") ? "Edge" : v.includes("firefox/") ? "Firefox" : /; wv|\bwv\b/.test(v) ? "WebView" : /chrome\/|crios\//.test(v) ? "Chrome" : v.includes("safari/") ? "Safari" : "Other"; }
