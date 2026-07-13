import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { loadIdentityConfig } from "@football-predictor/config";
import { createIdentityDatabase, DrizzleIdentityRepository } from "@football-predictor/db";
import { IdentityService, type PasswordHasher, type TokenFactory } from "@football-predictor/domain";

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
