import { createHash, randomUUID } from "node:crypto";
import type { LineupSnapshot, TeamLineup } from "@pulse/domain";
import { authorizeMatchRead } from "../../access";
import { getMatchApiRuntime, type LineupReadPort, type MatchReadAccess } from "../../runtime";

/**
 * Presentation status for the lineup surface. Derived from the supplier snapshot
 * status plus freshness — never invented, never a fake XI.
 * - LINEUP_PENDING: no lineup published yet (empty state, no players shown).
 * - CONFIRMED: official starting XI.
 * - EXPECTED: predicted/probable XI (shown, but labelled as not yet official).
 * - DATA_STALE: we still have a lineup but it has not refreshed recently — keep showing it, flag it.
 * - DATA_UNAVAILABLE: supplier has no lineup for this fixture, or the cache read failed.
 */
export type LineupApiStatus = "LINEUP_PENDING" | "CONFIRMED" | "EXPECTED" | "DATA_STALE" | "DATA_UNAVAILABLE";

export interface LineupApiView {
  status: LineupApiStatus;
  /** True only when status === "DATA_STALE"; the lineup below is the last good copy. */
  stale: boolean;
  /** Underlying supplier confirmation, preserved even when marked stale (true = official, false = expected). */
  confirmed: boolean;
  dataAsOf: string | null;
  capturedAt: string | null;
  home: TeamLineup | null;
  away: TeamLineup | null;
}

/** A lineup that has not been re-validated within this window is served but flagged DATA_STALE. */
export const LINEUP_STALE_AFTER_MS = 3 * 60 * 60 * 1_000;

type RouteContext = { params: Promise<{ matchId: string }> };

function correlationId(request: Request): string {
  const candidate = request.headers.get("x-correlation-id")?.trim();
  return candidate && candidate.length <= 128 ? candidate : randomUUID();
}

function etagOf(view: LineupApiView): string {
  return `"lineup-${createHash("sha256").update(JSON.stringify(view)).digest("hex").slice(0, 32)}"`;
}

function isStale(dataAsOf: string, now: Date, staleAfterMs: number): boolean {
  const age = now.getTime() - new Date(dataAsOf).getTime();
  return Number.isFinite(age) && age > staleAfterMs;
}

/**
 * Map a persisted lineup snapshot (or its absence) to the presentation view.
 * Pure and clock-injected so every state is unit-testable without a database.
 */
export function assessLineup(snapshot: LineupSnapshot | null, now: Date, staleAfterMs = LINEUP_STALE_AFTER_MS): LineupApiView {
  if (!snapshot) {
    return { status: "LINEUP_PENDING", stale: false, confirmed: false, dataAsOf: null, capturedAt: null, home: null, away: null };
  }
  const timing = { dataAsOf: snapshot.dataAsOf, capturedAt: snapshot.capturedAt };
  const empty = { ...timing, home: null, away: null } as const;

  switch (snapshot.status) {
    case "UNAVAILABLE":
      return { status: "DATA_UNAVAILABLE", stale: false, confirmed: false, ...empty };
    case "NOT_PUBLISHED":
      return { status: "LINEUP_PENDING", stale: false, confirmed: false, ...empty };
    case "CONFIRMED":
    case "EXPECTED": {
      // A "confirmed" row with no players anywhere has nothing real to render — treat as pending, not a blank pitch.
      const hasPlayers = snapshot.home.players.length > 0 || snapshot.away.players.length > 0;
      if (!hasPlayers) return { status: "LINEUP_PENDING", stale: false, confirmed: false, ...empty };
      const confirmed = snapshot.status === "CONFIRMED";
      const stale = isStale(snapshot.dataAsOf, now, staleAfterMs);
      return {
        status: stale ? "DATA_STALE" : confirmed ? "CONFIRMED" : "EXPECTED",
        stale,
        confirmed,
        ...timing,
        home: snapshot.home,
        away: snapshot.away,
      };
    }
  }
}

export function createLineupGet(
  lineup: LineupReadPort,
  access: MatchReadAccess,
  options: { now?: () => Date; staleAfterMs?: number } = {},
) {
  const now = options.now ?? (() => new Date());
  const staleAfterMs = options.staleAfterMs ?? LINEUP_STALE_AFTER_MS;
  return async function GET(request: Request, context: RouteContext): Promise<Response> {
    const requestId = correlationId(request);
    const authorization = await authorizeMatchRead(request, access);
    if (authorization instanceof Response) return authorization;
    try {
      const { matchId } = await context.params;
      const snapshot = await lineup.get(matchId);
      const view = assessLineup(snapshot, now(), staleAfterMs);
      const etag = etagOf(view);
      const headers = { etag, "cache-control": "private, max-age=30", "x-correlation-id": requestId };
      if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
      return Response.json({ data: view, meta: { correlationId: requestId, source: "product-cache" } }, { status: 200, headers });
    } catch {
      return Response.json(
        { error: { code: "DATA_UNAVAILABLE", message: "Lineup cache is temporarily unavailable", correlationId: requestId } },
        { status: 503, headers: { "cache-control": "no-store", "x-correlation-id": requestId } },
      );
    }
  };
}

export const GET = (request: Request, context: RouteContext) => {
  const runtime = getMatchApiRuntime();
  return createLineupGet(runtime.lineup, runtime.access)(request, context);
};
