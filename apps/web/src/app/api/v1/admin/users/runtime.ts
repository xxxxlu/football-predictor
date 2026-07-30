import { loadIdentityConfig } from "@pulse/config";
import { createIdentityDatabase, PostgresUserSecurityRepository } from "@pulse/db";
import { getIdentityService } from "../../auth/_lib/runtime";
import { createAdminIdentityHandlers } from "./handlers";

declare global { var __pulseUserSecurityRepository: PostgresUserSecurityRepository | undefined; }

export function userSecurityHandlers() {
  if (!globalThis.__pulseUserSecurityRepository) {
    const config = loadIdentityConfig(process.env);
    globalThis.__pulseUserSecurityRepository = new PostgresUserSecurityRepository(createIdentityDatabase(config.databaseUrl).sql);
  }
  return createAdminIdentityHandlers(getIdentityService(), globalThis.__pulseUserSecurityRepository);
}
