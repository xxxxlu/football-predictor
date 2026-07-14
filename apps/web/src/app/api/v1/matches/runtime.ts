import type postgres from "postgres";
import { createHash } from "node:crypto";
import { loadIdentityConfig } from "@football-predictor/config";
import { createIdentityDatabase, PostgresMatchSnapshotRepository } from "@football-predictor/db";
import { MatchCacheReader, OpenLigaDbWorldCupSync } from "@football-predictor/supplier";
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

type CurrentMatchView = { id?: string; status?: string; kickoffAt?: string };

export function visibleCurrentMatches<T extends CurrentMatchView>(views: T[], now: Date): T[] {
  const nowMs = now.getTime();
  return views.filter((view) => {
    if (view.status === "LIVE") return true;
    const kickoff = view.kickoffAt ? new Date(view.kickoffAt).getTime() : Number.NaN;
    return view.status === "SCHEDULED" && Number.isFinite(kickoff) && kickoff > nowMs;
  });
}

function etagOf(value: unknown): string { return `"${createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`; }

export class RefreshingCurrentMatchCache {
  private lastAttempt = 0;
  private pending: Promise<void> | undefined;
  private readonly reader: { list(): Promise<{ views: CurrentMatchView[]; etag: string }>; get(matchId: string): Promise<{ view: unknown; etag: string }> };
  private readonly sync: { run(): Promise<unknown> };
  private readonly now: () => Date;

  constructor(input: { reader: RefreshingCurrentMatchCache["reader"]; sync: RefreshingCurrentMatchCache["sync"]; now?: () => Date }) {
    this.reader = input.reader; this.sync = input.sync; this.now = input.now ?? (() => new Date());
  }

  private async refresh(): Promise<void> {
    const now = this.now().getTime();
    if (now - this.lastAttempt < 5 * 60_000) return;
    if (!this.pending) {
      this.lastAttempt = now;
      this.pending = this.sync.run().then(() => undefined).catch(() => undefined).finally(() => { this.pending = undefined; });
    }
    await this.pending;
  }

  async list(): Promise<{ views: CurrentMatchView[]; etag: string }> {
    await this.refresh();
    const result = await this.reader.list();
    const views = visibleCurrentMatches(result.views, this.now());
    return { views, etag: etagOf(views) };
  }

  async get(matchId: string): Promise<{ view: unknown; etag: string }> { await this.refresh(); return this.reader.get(matchId); }
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
  const currentSync = new OpenLigaDbWorldCupSync({ repository });
  return {
    cache: new RefreshingCurrentMatchCache({ reader, sync: currentSync }),
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
