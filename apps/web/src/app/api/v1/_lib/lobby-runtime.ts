import { loadIdentityConfig } from "@pulse/config";
import { createClubChannelRepository, getSharedIdentityDatabase, type ClubChannelRepository } from "@pulse/db";
import { governanceInbox } from "../admin/governance/runtime";
import { getIdentityService } from "../auth/_lib/runtime";
import { createLobbyHandlers } from "./lobby-handlers";

declare global { var __pulseClubChannelRepository: ClubChannelRepository | undefined; }

export function lobbyHandlers() {
  if (!globalThis.__pulseClubChannelRepository) {
    const config = loadIdentityConfig(process.env);
    globalThis.__pulseClubChannelRepository = createClubChannelRepository(getSharedIdentityDatabase(config.databaseUrl).sql);
  }
  // Channel reports land in the same governance inbox a community moderator
  // already reads (the 12.4 decision: one queue, never two).
  return createLobbyHandlers(getIdentityService(), globalThis.__pulseClubChannelRepository, governanceInbox());
}
