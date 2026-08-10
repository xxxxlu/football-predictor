import { loadIdentityConfig } from "@pulse/config";
import { getSharedIdentityDatabase, PostgresModerationPrivacyRepository } from "@pulse/db";
import { getIdentityService } from "../auth/_lib/runtime";
import { createModerationHandlers } from "./moderation-handlers";

declare global { var __pulseModerationRepository: PostgresModerationPrivacyRepository | undefined; }
export function moderationHandlers() {
  if (!globalThis.__pulseModerationRepository) {
    const config = loadIdentityConfig(process.env);
    globalThis.__pulseModerationRepository = new PostgresModerationPrivacyRepository(getSharedIdentityDatabase(config.databaseUrl).sql);
  }
  return createModerationHandlers(getIdentityService(), globalThis.__pulseModerationRepository, { secureCookie: process.env.APP_ENV === "production" });
}
