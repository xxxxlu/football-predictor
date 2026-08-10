import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadIdentityConfig } from "@pulse/config";
import { DrizzleRoomRepository, getSharedIdentityDatabase } from "@pulse/db";
import { RoomService } from "@pulse/domain";

declare global { var __pulseRoomService: RoomService | undefined; }

export function getRoomService() {
  if (globalThis.__pulseRoomService) return globalThis.__pulseRoomService;
  const config = loadIdentityConfig(process.env);
  const { db } = getSharedIdentityDatabase(config.databaseUrl);
  const tokens = {
    inviteToken: () => randomBytes(32).toString("base64url"),
    hash: (value: string) => createHash("sha256").update(value, "utf8").digest("hex"),
    id: () => randomUUID(),
  };
  globalThis.__pulseRoomService = new RoomService(new DrizzleRoomRepository(db), tokens, () => new Date(), { rulesVersion: config.rulesVersion, initialPoints: "10000.00" });
  return globalThis.__pulseRoomService;
}
