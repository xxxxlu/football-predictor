import { loadIdentityConfig } from "@pulse/config";
import { createIdentityDatabase, PostgresPrivacyRepository } from "@pulse/db";
import { getIdentityService } from "../auth/_lib/runtime";
import { createPrivacyHandlers } from "./privacy-handlers";

declare global {
  var __pulsePrivacyRepository: PostgresPrivacyRepository | undefined;
}

export function privacyRepository() {
  if (!globalThis.__pulsePrivacyRepository) {
    const config = loadIdentityConfig(process.env);
    const { sql } = createIdentityDatabase(config.databaseUrl);
    globalThis.__pulsePrivacyRepository = new PostgresPrivacyRepository(sql);
  }
  return globalThis.__pulsePrivacyRepository;
}

export function privacyHandlers() {
  return createPrivacyHandlers(getIdentityService(), privacyRepository());
}