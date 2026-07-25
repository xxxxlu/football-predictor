import type postgres from "postgres";
import { createHash } from "node:crypto";
import { loadIdentityConfig } from "@pulse/config";
import { createIdentityDatabase, PostgresMatchSnapshotRepository } from "@pulse/db";
import type { LineupSnapshot } from "@pulse/domain";
import { MatchCacheReader, type SupplierFreshness } from "@pulse/supplier";
import { getIdentityService } from "../auth/_lib/runtime";

export interface MatchReadAccess {
  authenticate(token: string): Promise<{ id: string } | null>;
  assertRoomMember(roomId: string, userId: string): Promise<void>;
}

/** Read-only port over the persisted lineup cache. Reads never call an external supplier. */
export interface LineupReadPort {
  get(matchId: string): Promise<LineupSnapshot | null>;
}

export type { SupplierFreshness };

export interface MatchApiRuntime {
  cache: {
    list(): Promise<{ views: unknown[]; etag: string }>;
    get(matchId: string): Promise<{ view: unknown; etag: string }>;
    /** Optional freshness metadata for the list response; null when the repository cannot provide it. */
    freshness?(): Promise<SupplierFreshness | null>;
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
  private readonly readFreshness: (() => Promise<SupplierFreshness>) | undefined;
  private readonly now: () => Date;

  constructor(input: { reader: CurrentMatchCache["reader"]; freshness?: () => Promise<SupplierFreshness>; now?: () => Date }) {
    this.reader = input.reader; this.readFreshness = input.freshness; this.now = input.now ?? (() => new Date());
  }

  async list(): Promise<{ views: CurrentMatchView[]; etag: string }> {
    const result = await this.reader.list();
    const views = visibleCurrentMatches(result.views, this.now());
    return { views, etag: etagOf(views) };
  }

  async get(matchId: string): Promise<{ view: unknown; etag: string }> { return this.reader.get(matchId); }

  /** Null-safe: repositories without a freshness read model simply yield null metadata. */
  async freshness(): Promise<SupplierFreshness | null> {
    if (!this.readFreshness) return null;
    try { return await this.readFreshness(); }
    catch { return null; }
  }
}

declare global {
  var __pulseMatchApiRuntime: MatchApiRuntime | undefined;
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
    cache: new CurrentMatchCache({ reader, freshness: () => repository.getFreshness() }),
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
  if (globalThis.__pulseMatchApiRuntime) return globalThis.__pulseMatchApiRuntime;
  const config = loadIdentityConfig(process.env);
  const database = createIdentityDatabase(config.databaseUrl);
  globalThis.__pulseMatchApiRuntime = createMatchApiRuntime({ sql: database.sql, close: database.close });
  return globalThis.__pulseMatchApiRuntime;
}

export async function closeMatchApiRuntime(): Promise<void> {
  const runtime = globalThis.__pulseMatchApiRuntime;
  globalThis.__pulseMatchApiRuntime = undefined;
  await runtime?.close();
}

export class MatchAccessError extends Error {
  constructor(readonly code: "ROOM_NOT_FOUND", readonly status: 404) { super(code); this.name = "MatchAccessError"; }
}
