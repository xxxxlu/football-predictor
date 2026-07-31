import { loadIdentityConfig } from "@pulse/config";
import { createIdentityDatabase, createRoomChatRepository, type RoomChatRepository } from "@pulse/db";
import { governanceInbox } from "../../admin/governance/runtime";
import { getIdentityService } from "../../auth/_lib/runtime";
import { createRoomChatHandlers } from "./chat-handlers";

declare global { var __pulseRoomChatRepository: RoomChatRepository | undefined; }

export function chatHandlers() {
  if (!globalThis.__pulseRoomChatRepository) {
    const config = loadIdentityConfig(process.env);
    globalThis.__pulseRoomChatRepository = createRoomChatRepository(createIdentityDatabase(config.databaseUrl).sql);
  }
  // Message reports reuse the governance inbox write path, so the report a chat
  // member files lands in the same queue a community moderator already reads.
  return createRoomChatHandlers(getIdentityService(), globalThis.__pulseRoomChatRepository, governanceInbox());
}
