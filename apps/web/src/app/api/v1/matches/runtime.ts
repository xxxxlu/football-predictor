import type postgres from "postgres";
import { loadIdentityConfig } from "@football-predictor/config";
import { createIdentityDatabase, PostgresMatchSnapshotRepository } from "@football-predictor/db";
import { MatchCacheReader } from "@football-predictor/supplier";
import { getIdentityService } from "../auth/_lib/runtime";

export interface MatchReadAccess {
  authenticate(token: string): Promise<{ id: string } | null>;
  assertRoomMember(roomId: string, userId: string): Promise<void>;
}

export interface MatchApiRuntime {
  cache: {
    list(): Promise<{ views: unknown[]; etag: string }>;
    get(matchId: string): Promise<{ view: unknown; etag: string }>;
  };
  access: MatchReadAccess;
  close(): Promise<void>;
}

declare global {
  var __footballPredictorMatchApiRuntime: MatchApiRuntime | undefined;
}

export function createMatchApiRuntime(input: {
  sql: postgres.Sql;
  close(): Promise<void>;
  identity?: { authenticate(token: string): Promise<{ id: string } | null> };
}): MatchApiRuntime {
  const identity = input.identity ?? getIdentityService();
  const repository = new PostgresMatchSnapshotRepository(input.sql);
  return {
    cache: new MatchCacheReader({ repository }),
    access: {
      authenticate: (token) => identity.authenticate(token),
      assertRoomMember: async (roomId, userId) => {
        const [membership] = await input.sql<Array<{ member: boolean }>>`
          SELECT EXISTS(SELECT 1 FROM room.members WHERE room_id=${roomId} AND user_id=${userId}) AS member`;
        if (!membership?.member) throw new MatchAccessError("ROOM_NOT_FOUND", 404);
      },
    },
    close: input.close,
  };
}

export function getMatchApiRuntime(): MatchApiRuntime {
  if (globalThis.__footballPredictorMatchApiRuntime) return globalThis.__footballPredictorMatchApiRuntime;
  const config = loadIdentityConfig(process.env);
  const database = createIdentityDatabase(config.databaseUrl);
  globalThis.__footballPredictorMatchApiRuntime = createMatchApiRuntime({ sql: database.sql, close: database.close });
  return globalThis.__footballPredictorMatchApiRuntime;
}

export async function closeMatchApiRuntime(): Promise<void> {
  const runtime = globalThis.__footballPredictorMatchApiRuntime;
  globalThis.__footballPredictorMatchApiRuntime = undefined;
  await runtime?.close();
}

export class MatchAccessError extends Error {
  constructor(readonly code: "ROOM_NOT_FOUND", readonly status: 404) { super(code); this.name = "MatchAccessError"; }
}
