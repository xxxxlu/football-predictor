import { loadIdentityConfig } from "@pulse/config";
import { createClubRepository, createIdentityDatabase, type ClubRepository } from "@pulse/db";
import { getIdentityService } from "../auth/_lib/runtime";
import { createClubHandlers } from "./club-handlers";

declare global { var __pulseClubRepository: ClubRepository | undefined; }
export function clubHandlers() {
  if (!globalThis.__pulseClubRepository) {
    const config = loadIdentityConfig(process.env);
    globalThis.__pulseClubRepository = createClubRepository(createIdentityDatabase(config.databaseUrl).sql);
  }
  return createClubHandlers(getIdentityService(), globalThis.__pulseClubRepository);
}
