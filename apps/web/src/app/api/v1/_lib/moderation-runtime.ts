import { loadIdentityConfig } from "@football-predictor/config";
import { createIdentityDatabase, PostgresModerationPrivacyRepository } from "@football-predictor/db";
import { getIdentityService } from "../auth/_lib/runtime";
import { createModerationHandlers } from "./moderation-handlers";

declare global { var __footballPredictorModerationRepository: PostgresModerationPrivacyRepository | undefined; }
export function moderationHandlers() {
  if (!globalThis.__footballPredictorModerationRepository) {
    const config = loadIdentityConfig(process.env);
    globalThis.__footballPredictorModerationRepository = new PostgresModerationPrivacyRepository(createIdentityDatabase(config.databaseUrl).sql);
  }
  return createModerationHandlers(getIdentityService(), globalThis.__footballPredictorModerationRepository, { secureCookie: process.env.APP_ENV === "production" });
}
