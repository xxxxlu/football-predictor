import type postgres from "postgres";
import { createHash } from "node:crypto";
import { loadIdentityConfig } from "@football-predictor/config";
import { createIdentityDatabase, PostgresMatchSnapshotRepository } from "@football-predictor/db";
import type { LineupSnapshot } from "@football-predictor/domain";
import { MatchCacheReader } from "@football-predictor/supplier";
import { getIdentityService } from "../auth/_lib/runtime";

export interface MatchReadAccess {
  authenticate(token: string): Promise<{ id: string } | null>;
  assertRoomMember(roomId: string, userId: string): Promise<void>;
}

/** Read-only port over the persisted lineup cache. Reads never call an external supplier. */
export interface LineupReadPort {
  get(matchId: string): Promise<LineupSnapshot | null>;
}

export interface MatchApiRuntime {
  cache: {
    list(): Promise<{ views: unknown[]; etag: string }>;
    get(matchId: string): Promise<{ view: unknown; etag: string }>;
  };
  lineup: LineupReadPort;
  access: MatchReadAccess;
  close(): Promise<void>;
}

type CurrentMatchView = { id?: string; status?: string; kickoffAt?: string };

export function visibleCurrentMatches<T extends CurrentMatchView>(views: T[], now: Date): T[] {
  const nowMs = now.getTime();
  return views.filter((view) => {
    if (view.status === "LIVE" || view.status === "FINISHED") return true;
    const kickoff = view.kickoffAt ? new Date(view.kickoffAt).getTime() : Number.NaN;
    return view.status === "SCHEDULED" && Number.isFinite(kickoff) && kickoff > nowMs;
  });
}

function etagOf(value: unknown): string { return `"${createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`; }

export class CurrentMatchCache {
  private readonly reader: { list(): Promise<{ views: CurrentMatchView[]; etag: string }>; get(matchId: string): Promise<{ view: unknown; etag: string }> };
  private readonly now: () => Date;

  constructor(input: { reader: CurrentMatchCache["reader"]; now?: () => Date }) {
    this.reader = input.reader; this.now = input.now ?? (() => new Date());
  }

  async list(): Promise<{ views: CurrentMatchView[]; etag: string }> {
    const result = await this.reader.list();
    const views = visibleCurrentMatches(result.views, this.now());
    return { views, etag: etagOf(views) };
  }

  async get(matchId: string): Promise<{ view: unknown; etag: string }> { return this.reader.get(matchId); }
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
  const reader = new MatchCacheReader({ repository });
  return {
    cache: new CurrentMatchCache({ reader }),
    lineup: { get: (matchId) => repository.getLineup(matchId) },
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
