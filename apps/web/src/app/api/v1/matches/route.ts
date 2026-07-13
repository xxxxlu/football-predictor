import { randomUUID } from "node:crypto";

export interface MatchListCachePort {
  list(): Promise<{ views: unknown[]; etag: string }>;
}

function correlationId(request: Request): string {
  const candidate = request.headers.get("x-correlation-id")?.trim();
  return candidate && candidate.length <= 128 ? candidate : randomUUID();
}

export function createMatchesGet(cache: MatchListCachePort) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = correlationId(request);
    try {
      const result = await cache.list();
      const headers = { etag: result.etag, "cache-control": "private, max-age=30", "x-correlation-id": requestId };
      if (request.headers.get("if-none-match") === result.etag) return new Response(null, { status: 304, headers });
      return Response.json({ data: result.views, meta: { correlationId: requestId, source: "product-cache" } }, { status: 200, headers });
    } catch {
      return Response.json({ error: { code: "DATA_UNAVAILABLE", message: "Match cache is temporarily unavailable", correlationId: requestId } }, { status: 503, headers: { "cache-control": "no-store", "x-correlation-id": requestId } });
    }
  };
}

const unavailableCache: MatchListCachePort = {
  async list() { throw Object.assign(new Error("Persistent match cache is not configured"), { code: "CACHE_UNAVAILABLE" }); },
};

export const GET = createMatchesGet(unavailableCache);
