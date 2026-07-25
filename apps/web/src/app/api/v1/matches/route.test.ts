import { describe, expect, it } from "vitest";
import { createMatchesGet, GET } from "./route.js";

describe("GET /api/v1/matches", () => {
  it("uses the production runtime product cache instead of an unavailable placeholder", async () => {
    const runtime = {
      cache: { list: async () => ({ views: [{ id: "postgres-match" }], etag: '"postgres-cache"' }) },
      access: {
        authenticate: async () => ({ id: "user-1" }),
        assertRoomMember: async () => undefined,
      },
      close: async () => undefined,
    };
    (globalThis as unknown as { __footballPredictorMatchApiRuntime?: typeof runtime }).__footballPredictorMatchApiRuntime = runtime;
    try {
      const response = await GET(new Request("http://localhost/api/v1/matches", { headers: { cookie: "fp_session=valid" } }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: [{ id: "postgres-match" }] });
    } finally {
      delete (globalThis as unknown as { __footballPredictorMatchApiRuntime?: typeof runtime }).__footballPredictorMatchApiRuntime;
    }
  });

  it("serves the product cache and honors conditional ETag requests", async () => {
    let reads = 0;
    const GET = createMatchesGet(
      { list: async () => { reads += 1; return { views: [{ id: "match-1" }], etag: '"cache-v1"' }; } },
      { authenticate: async () => ({ id: "user-1" }), assertRoomMember: async () => undefined },
    );

    const first = await GET(new Request("http://localhost/api/v1/matches", { headers: { cookie: "fp_session=valid" } }));
    const conditional = await GET(new Request("http://localhost/api/v1/matches", { headers: { cookie: "fp_session=valid", "if-none-match": '"cache-v1"' } }));

    expect(first.status).toBe(200);
    expect(first.headers.get("etag")).toBe('"cache-v1"');
    expect(await first.json()).toMatchObject({ data: [{ id: "match-1" }] });
    expect(conditional.status).toBe(304);
    expect(reads).toBe(2);
  });

  it("exposes freshness metadata in meta and stays null-safe when the repository lacks it", async () => {
    const access = { authenticate: async () => ({ id: "user-1" }), assertRoomMember: async () => undefined };
    const freshness = { lastCapturedAt: "2026-07-24T08:00:00.000Z", nextKickoffAt: "2026-08-07T18:30:00.000Z", nextKickoffCompetition: "德国足球甲级联赛", upcomingCount: 9, liveCount: 0, finishedRecentCount: 1 };
    const withFreshness = createMatchesGet({ list: async () => ({ views: [], etag: '"v1"' }), freshness: async () => freshness }, access);
    const withoutFreshness = createMatchesGet({ list: async () => ({ views: [], etag: '"v1"' }) }, access);
    const failingFreshness = createMatchesGet({ list: async () => ({ views: [], etag: '"v1"' }), freshness: async () => { throw new Error("db down"); } }, access);
    const request = () => new Request("http://localhost/api/v1/matches", { headers: { cookie: "fp_session=valid" } });

    expect(await (await withFreshness(request())).json()).toMatchObject({ meta: { source: "product-cache", freshness } });
    expect(await (await withoutFreshness(request())).json()).toMatchObject({ meta: { freshness: null } });
    expect(await (await failingFreshness(request())).json()).toMatchObject({ meta: { freshness: null } });

    const conditional = await withFreshness(new Request("http://localhost/api/v1/matches", { headers: { cookie: "fp_session=valid", "if-none-match": '"v1"' } }));
    expect(conditional.status).toBe(304);
  });

  it("returns an explicit cache-unavailable error and never accepts an upstream callback", async () => {
    const GET = createMatchesGet(
      { list: async () => { throw Object.assign(new Error("missing"), { code: "CACHE_UNAVAILABLE" }); } },
      { authenticate: async () => ({ id: "user-1" }), assertRoomMember: async () => undefined },
    );
    const response = await GET(new Request("http://localhost/api/v1/matches", { headers: { cookie: "fp_session=valid" } }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "DATA_UNAVAILABLE" } });
  });

  it("requires a valid session before reading the product cache", async () => {
    let reads = 0;
    const GET = createMatchesGet(
      { list: async () => { reads += 1; return { views: [], etag: '"empty"' }; } },
      { authenticate: async () => null, assertRoomMember: async () => undefined },
    );

    const response = await GET(new Request("http://localhost/api/v1/matches"));

    expect(response.status).toBe(401);
    expect(reads).toBe(0);
  });

  it("validates room membership when roomId is present", async () => {
    const checked: string[] = [];
    const GET = createMatchesGet(
      { list: async () => ({ views: [], etag: '"empty"' }) },
      { authenticate: async () => ({ id: "user-1" }), assertRoomMember: async (roomId, userId) => { checked.push(`${roomId}:${userId}`); } },
    );

    const response = await GET(new Request("http://localhost/api/v1/matches?roomId=room-1", { headers: { cookie: "fp_session=valid" } }));

    expect(response.status).toBe(200);
    expect(checked).toEqual(["room-1:user-1"]);
  });
});
