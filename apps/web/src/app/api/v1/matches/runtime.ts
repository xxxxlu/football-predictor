import type postgres from "postgres";
import { createHash } from "node:crypto";
import { loadIdentityConfig } from "@pulse/config";
import { closeSharedIdentityDatabases, getSharedIdentityDatabase, PostgresMatchSnapshotRepository } from "@pulse/db";
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

/**
 * How long a built list may be reused. The response already tells browsers
 * `max-age=30`, so a 15-second server memo is strictly fresher than what a
 * client is allowed to hold — it costs no correctness the product had not
 * already accepted, and it is what turns an ETag hit from "five queries then
 * discard the answer" into "compare two strings".
 */
export const MATCH_LIST_MEMO_MS = 15_000;

/** The first instant `visibleCurrentMatches` would return something different:
 *  the earliest kickoff still ahead of us. LIVE and FINISHED views are kept
 *  regardless of the clock, so only a SCHEDULED one can age out of the list. */
function nextVisibilityChange(views: CurrentMatchView[], nowMs: number): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const view of views) {
    if (view.status !== "SCHEDULED") continue;
    const kickoff = view.kickoffAt ? new Date(view.kickoffAt).getTime() : Number.NaN;
    if (Number.isFinite(kickoff) && kickoff > nowMs && kickoff < earliest) earliest = kickoff;
  }
  return earliest;
}

export class CurrentMatchCache {
  private readonly reader: { list(): Promise<{ views: CurrentMatchView[]; etag: string }>; get(matchId: string): Promise<{ view: unknown; etag: string }> };
  private readonly readFreshness: (() => Promise<SupplierFreshness>) | undefined;
  private readonly now: () => Date;
  private readonly memoMs: number;
  private listMemo: { views: CurrentMatchView[]; etag: string; expiresAt: number } | null = null;
  private freshnessMemo: { value: SupplierFreshness | null; expiresAt: number } | null = null;
  /** One in-flight read serves every concurrent caller: without it a cold cache
   *  under load fires the five-query read once per request rather than once. */
  private inFlight: Promise<{ views: CurrentMatchView[]; etag: string }> | null = null;

  constructor(input: { reader: CurrentMatchCache["reader"]; freshness?: () => Promise<SupplierFreshness>; now?: () => Date; memoMs?: number }) {
    this.reader = input.reader; this.readFreshness = input.freshness; this.now = input.now ?? (() => new Date());
    this.memoMs = input.memoMs ?? MATCH_LIST_MEMO_MS;
  }

  async list(): Promise<{ views: CurrentMatchView[]; etag: string }> {
    const nowMs = this.now().getTime();
    const memo = this.listMemo;
    if (memo && nowMs < memo.expiresAt) return { views: memo.views, etag: memo.etag };
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.read(nowMs).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async read(nowMs: number): Promise<{ views: CurrentMatchView[]; etag: string }> {
    const result = await this.reader.list();
    const views = visibleCurrentMatches(result.views, new Date(nowMs));
    const etag = etagOf(views);
    // Expire at whichever comes first: the memo window, or the moment a
    // scheduled match kicks off and drops out of the filter. That second bound
    // is what keeps a memoized list exactly as correct as a freshly built one.
    this.listMemo = { views, etag, expiresAt: Math.min(nowMs + this.memoMs, nextVisibilityChange(views, nowMs)) };
    return { views, etag };
  }

  async get(matchId: string): Promise<{ view: unknown; etag: string }> { return this.reader.get(matchId); }

  /** Null-safe: repositories without a freshness read model simply yield null metadata. */
  async freshness(): Promise<SupplierFreshness | null> {
    if (!this.readFreshness) return null;
    const nowMs = this.now().getTime();
    const memo = this.freshnessMemo;
    if (memo && nowMs < memo.expiresAt) return memo.value;
    try {
      const value = await this.readFreshness();
      this.freshnessMemo = { value, expiresAt: nowMs + this.memoMs };
      return value;
    } catch {
      // A failed aggregate is not memoized: the next request should retry it
      // rather than serve "unknown freshness" for the whole window.
      return null;
    }
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
  const database = getSharedIdentityDatabase(config.databaseUrl);
  // The pool is shared with every other API runtime, so tearing this runtime
  // down means tearing the shared pool down — never just this route's slice.
  globalThis.__pulseMatchApiRuntime = createMatchApiRuntime({ sql: database.sql, close: closeSharedIdentityDatabases });
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
