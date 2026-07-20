import { describe, expect, it } from "vitest";
import type { LineupPlayer, LineupSnapshot, LineupStatus, TeamLineup } from "@football-predictor/domain";
import { assessLineup, createLineupGet, GET } from "./route.js";

const NOW = new Date("2026-07-19T18:30:00.000Z");

function player(overrides: Partial<LineupPlayer> = {}): LineupPlayer {
  return {
    id: 1,
    name: "球员",
    number: 10,
    position: "MID",
    positionRaw: "Midfielder",
    grid: "2:2",
    photoUrl: null,
    starter: true,
    status: "STARTING",
    ...overrides,
  };
}

function team(overrides: Partial<TeamLineup> = {}): TeamLineup {
  return {
    teamId: 10,
    name: "英格兰",
    logoUrl: null,
    primaryColor: "#0b2a5b",
    formation: "4-3-3",
    coach: null,
    players: [player()],
    ...overrides,
  };
}

function snapshot(status: LineupStatus, overrides: Partial<LineupSnapshot> = {}): LineupSnapshot {
  return {
    fixtureId: "openligadb:7001",
    supplierFixtureId: 7001,
    status,
    dataAsOf: "2026-07-19T18:00:00.000Z",
    capturedAt: "2026-07-19T18:00:01.000Z",
    home: team(),
    away: team({ teamId: 20, name: "阿根廷", formation: "4-4-2" }),
    ...overrides,
  };
}

const access = { authenticate: async () => ({ id: "user-1" }), assertRoomMember: async () => undefined };

describe("assessLineup status mapping", () => {
  it("returns LINEUP_PENDING with no players when nothing is cached", () => {
    const view = assessLineup(null, NOW);
    expect(view).toMatchObject({ status: "LINEUP_PENDING", stale: false, confirmed: false, home: null, away: null });
  });

  it("maps a fresh confirmed snapshot to CONFIRMED and keeps both teams", () => {
    const view = assessLineup(snapshot("CONFIRMED"), NOW);
    expect(view.status).toBe("CONFIRMED");
    expect(view.confirmed).toBe(true);
    expect(view.stale).toBe(false);
    expect(view.home?.formation).toBe("4-3-3");
    expect(view.away?.name).toBe("阿根廷");
  });

  it("keeps predicted lineups visible but labels them EXPECTED, not confirmed", () => {
    const view = assessLineup(snapshot("EXPECTED"), NOW);
    expect(view.status).toBe("EXPECTED");
    expect(view.confirmed).toBe(false);
    expect(view.home?.players).toHaveLength(1);
  });

  it("keeps the old lineup but flags DATA_STALE once it has not refreshed within the window", () => {
    // dataAsOf 4h before NOW, threshold 3h.
    const stale = snapshot("CONFIRMED", { dataAsOf: "2026-07-19T14:30:00.000Z" });
    const view = assessLineup(stale, NOW, 3 * 60 * 60 * 1_000);
    expect(view.status).toBe("DATA_STALE");
    expect(view.stale).toBe(true);
    expect(view.confirmed).toBe(true); // underlying confirmation preserved for the UI
    expect(view.home?.players).toHaveLength(1); // lineup retained, not dropped
  });

  it("treats NOT_PUBLISHED as a pending empty state with no players", () => {
    const view = assessLineup(snapshot("NOT_PUBLISHED", { home: team({ players: [] }), away: team({ players: [] }) }), NOW);
    expect(view).toMatchObject({ status: "LINEUP_PENDING", home: null, away: null });
  });

  it("maps supplier UNAVAILABLE to DATA_UNAVAILABLE without inventing players", () => {
    const view = assessLineup(snapshot("UNAVAILABLE", { home: team({ players: [] }), away: team({ players: [] }) }), NOW);
    expect(view).toMatchObject({ status: "DATA_UNAVAILABLE", home: null, away: null });
  });

  it("downgrades a confirmed-but-empty snapshot to LINEUP_PENDING instead of a blank pitch", () => {
    const view = assessLineup(snapshot("CONFIRMED", { home: team({ players: [] }), away: team({ players: [] }) }), NOW);
    expect(view.status).toBe("LINEUP_PENDING");
    expect(view.home).toBeNull();
  });
});

describe("GET /api/v1/matches/:matchId/lineup", () => {
  function request(headers: Record<string, string> = {}) {
    return new Request("http://localhost/api/v1/matches/openligadb:7001/lineup", { headers: { cookie: "fp_session=valid", ...headers } });
  }
  const context = { params: Promise.resolve({ matchId: "openligadb:7001" }) };

  it("serves a cached confirmed lineup as 200 with a private cache header", async () => {
    const handler = createLineupGet({ get: async () => snapshot("CONFIRMED") }, access, { now: () => NOW });
    const response = await handler(request(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=30");
    expect(await response.json()).toMatchObject({ data: { status: "CONFIRMED" }, meta: { source: "product-cache" } });
  });

  it("returns 304 when the caller already holds the current lineup etag", async () => {
    const handler = createLineupGet({ get: async () => snapshot("CONFIRMED") }, access, { now: () => NOW });
    const first = await handler(request(), context);
    const etag = first.headers.get("etag") ?? "";

    const second = await handler(request({ "if-none-match": etag }), context);
    expect(second.status).toBe(304);
  });

  it("never reads the cache for an unauthenticated request", async () => {
    let reads = 0;
    const handler = createLineupGet(
      { get: async () => { reads += 1; return null; } },
      { authenticate: async () => null, assertRoomMember: async () => undefined },
      { now: () => NOW },
    );
    const response = await handler(new Request("http://localhost/api/v1/matches/x/lineup"), context);

    expect(response.status).toBe(401);
    expect(reads).toBe(0);
  });

  it("degrades to 503 DATA_UNAVAILABLE when the cache read throws", async () => {
    const handler = createLineupGet({ get: async () => { throw new Error("db down"); } }, access, { now: () => NOW });
    const response = await handler(request(), context);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "DATA_UNAVAILABLE" } });
  });

  it("reads lineups through the production PostgreSQL-backed runtime", async () => {
    // NOT_PUBLISHED is clock-independent, so this proves a real snapshot flows through
    // runtime.lineup.get without depending on wall-clock freshness (covered separately above).
    let reads = 0;
    const runtime = {
      cache: { list: async () => ({ views: [], etag: '"x"' }), get: async () => ({ view: {}, etag: '"y"' }) },
      lineup: { get: async (matchId: string) => { reads += 1; return snapshot("NOT_PUBLISHED", { fixtureId: matchId }); } },
      access,
      close: async () => undefined,
    };
    (globalThis as unknown as { __footballPredictorMatchApiRuntime?: typeof runtime }).__footballPredictorMatchApiRuntime = runtime;
    try {
      const response = await GET(request(), context);
      expect(response.status).toBe(200);
      expect(reads).toBe(1);
      expect(await response.json()).toMatchObject({ data: { status: "LINEUP_PENDING" } });
    } finally {
      delete (globalThis as unknown as { __footballPredictorMatchApiRuntime?: typeof runtime }).__footballPredictorMatchApiRuntime;
    }
  });
});
