import { loadIdentityConfig } from "@pulse/config";
import { createIdentityDatabase, createSocialRepository, type SocialRepository } from "@pulse/db";
import { getIdentityService } from "../auth/_lib/runtime";
import { createSocialHandlers } from "./social-handlers";

declare global { var __pulseSocialRepository: SocialRepository | undefined; }
export function socialHandlers() {
  if (!globalThis.__pulseSocialRepository) {
    const config = loadIdentityConfig(process.env);
    globalThis.__pulseSocialRepository = createSocialRepository(createIdentityDatabase(config.databaseUrl).sql);
  }
  return createSocialHandlers(getIdentityService(), globalThis.__pulseSocialRepository);
}
