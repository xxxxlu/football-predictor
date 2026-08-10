import { loadIdentityConfig } from "@pulse/config";
import { getSharedIdentityDatabase, PostgresGovernanceInboxRepository } from "@pulse/db";
import { getIdentityService } from "../../auth/_lib/runtime";
import { createGovernanceInboxHandlers } from "./handlers";

declare global { var __pulseGovernanceInboxRepository: PostgresGovernanceInboxRepository | undefined; }

export function governanceInbox() {
  if (!globalThis.__pulseGovernanceInboxRepository) {
    const config = loadIdentityConfig(process.env);
    globalThis.__pulseGovernanceInboxRepository = new PostgresGovernanceInboxRepository(getSharedIdentityDatabase(config.databaseUrl).sql);
  }
  return globalThis.__pulseGovernanceInboxRepository;
}

export function governanceHandlers() {
  return createGovernanceInboxHandlers(getIdentityService(), governanceInbox());
}
