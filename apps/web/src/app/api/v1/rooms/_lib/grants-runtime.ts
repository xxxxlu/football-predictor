import { randomUUID } from "node:crypto";
import { loadIdentityConfig } from "@pulse/config";
import { createRoomGrantRepository, getSharedIdentityDatabase } from "@pulse/db";
import { RoomGrantService } from "@pulse/domain";
import { getIdentityService } from "../../auth/_lib/runtime";
import { createRoomGrantHandlers } from "./grants-handlers";

declare global { var __pulseRoomGrantService: RoomGrantService | undefined; }

export function grantHandlers() {
  if (!globalThis.__pulseRoomGrantService) {
    const config = loadIdentityConfig(process.env);
    globalThis.__pulseRoomGrantService = new RoomGrantService(
      createRoomGrantRepository(getSharedIdentityDatabase(config.databaseUrl).sql),
      { id: () => randomUUID() },
      () => new Date(),
    );
  }
  return createRoomGrantHandlers(getIdentityService(), globalThis.__pulseRoomGrantService);
}
