import { describe, expect, it } from "vitest";
import { createMatchesGet } from "./route.js";

describe("GET /api/v1/matches", () => {
  it("serves the product cache and honors conditional ETag requests", async () => {
    let reads = 0;
    const GET = createMatchesGet({ list: async () => { reads += 1; return { views: [{ id: "match-1" }], etag: '"cache-v1"' }; } });

    const first = await GET(new Request("http://localhost/api/v1/matches"));
    const conditional = await GET(new Request("http://localhost/api/v1/matches", { headers: { "if-none-match": '"cache-v1"' } }));

    expect(first.status).toBe(200);
    expect(first.headers.get("etag")).toBe('"cache-v1"');
    expect(await first.json()).toMatchObject({ data: [{ id: "match-1" }] });
    expect(conditional.status).toBe(304);
    expect(reads).toBe(2);
  });

  it("returns an explicit cache-unavailable error and never accepts an upstream callback", async () => {
    const GET = createMatchesGet({ list: async () => { throw Object.assign(new Error("missing"), { code: "CACHE_UNAVAILABLE" }); } });
    const response = await GET(new Request("http://localhost/api/v1/matches"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "DATA_UNAVAILABLE" } });
  });
});
