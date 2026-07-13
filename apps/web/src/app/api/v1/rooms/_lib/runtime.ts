import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadIdentityConfig } from "@football-predictor/config";
import { createIdentityDatabase, DrizzleRoomRepository } from "@football-predictor/db";
import { RoomService } from "@football-predictor/domain";

declare global { var __footballPredictorRoomService: RoomService | undefined; }

export function getRoomService() {
  if (globalThis.__footballPredictorRoomService) return globalThis.__footballPredictorRoomService;
  const config = loadIdentityConfig(process.env);
  const { db } = createIdentityDatabase(config.databaseUrl);
  const tokens = {
    inviteToken: () => randomBytes(32).toString("base64url"),
    hash: (value: string) => createHash("sha256").update(value, "utf8").digest("hex"),
    id: () => randomUUID(),
  };
  globalThis.__footballPredictorRoomService = new RoomService(new DrizzleRoomRepository(db), tokens, () => new Date(), { rulesVersion: config.rulesVersion, initialPoints: "10000.00" });
  return globalThis.__footballPredictorRoomService;
}
