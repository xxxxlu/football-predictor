import { describe, expect, it } from "vitest";
import { createMatchGet } from "./route.js";

describe("GET /api/v1/matches/:matchId", () => {
  it("reads one cached match and returns 304 for a matching ETag", async () => {
    const GET = createMatchGet({ get: async (matchId) => ({ view: { id: matchId, capabilities: { livePrediction: false } }, etag: '"match-v1"' }) });
    const request = new Request("http://localhost/api/v1/matches/match-1", { headers: { "if-none-match": '"match-v1"' } });

    const response = await GET(request, { params: Promise.resolve({ matchId: "match-1" }) });

    expect(response.status).toBe(304);
  });

  it("returns DATA_UNAVAILABLE when the product cache has no match", async () => {
    const GET = createMatchGet({ get: async () => { throw new Error("missing"); } });
    const response = await GET(new Request("http://localhost/api/v1/matches/missing"), { params: Promise.resolve({ matchId: "missing" }) });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "DATA_UNAVAILABLE" } });
  });
});
