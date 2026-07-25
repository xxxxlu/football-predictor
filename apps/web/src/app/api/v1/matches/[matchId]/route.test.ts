import { describe, expect, it } from "vitest";
import { createMatchGet, GET } from "./route.js";

describe("GET /api/v1/matches/:matchId", () => {
  it("uses the production runtime PostgreSQL-backed cache", async () => {
    const runtime = {
      cache: { get: async (matchId: string) => ({ view: { id: matchId }, etag: '"postgres-cache"' }) },
      access: {
        authenticate: async () => ({ id: "user-1" }),
        assertRoomMember: async () => undefined,
      },
      close: async () => undefined,
    };
    (globalThis as unknown as { __pulseMatchApiRuntime?: typeof runtime }).__pulseMatchApiRuntime = runtime;
    try {
      const response = await GET(
        new Request("http://localhost/api/v1/matches/postgres-match", { headers: { cookie: "fp_session=valid" } }),
        { params: Promise.resolve({ matchId: "postgres-match" }) },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { id: "postgres-match" } });
    } finally {
      delete (globalThis as unknown as { __pulseMatchApiRuntime?: typeof runtime }).__pulseMatchApiRuntime;
    }
  });

  it("reads one cached match and returns 304 for a matching ETag", async () => {
    const GET = createMatchGet(
      { get: async (matchId) => ({ view: { id: matchId, capabilities: { livePrediction: false } }, etag: '"match-v1"' }) },
      { authenticate: async () => ({ id: "user-1" }), assertRoomMember: async () => undefined },
    );
    const request = new Request("http://localhost/api/v1/matches/match-1", { headers: { cookie: "fp_session=valid", "if-none-match": '"match-v1"' } });

    const response = await GET(request, { params: Promise.resolve({ matchId: "match-1" }) });

    expect(response.status).toBe(304);
  });

  it("returns DATA_UNAVAILABLE when the product cache has no match", async () => {
    const GET = createMatchGet(
      { get: async () => { throw new Error("missing"); } },
      { authenticate: async () => ({ id: "user-1" }), assertRoomMember: async () => undefined },
    );
    const response = await GET(new Request("http://localhost/api/v1/matches/missing", { headers: { cookie: "fp_session=valid" } }), { params: Promise.resolve({ matchId: "missing" }) });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "DATA_UNAVAILABLE" } });
  });

  it("does not read a match without an authenticated session", async () => {
    let reads = 0;
    const GET = createMatchGet(
      { get: async () => { reads += 1; return { view: {}, etag: '"cache"' }; } },
      { authenticate: async () => null, assertRoomMember: async () => undefined },
    );

    const response = await GET(new Request("http://localhost/api/v1/matches/match-1"), { params: Promise.resolve({ matchId: "match-1" }) });

    expect(response.status).toBe(401);
    expect(reads).toBe(0);
  });
});
