import { randomUUID } from "node:crypto";

export interface MatchCachePort {
  get(matchId: string): Promise<{ view: unknown; etag: string }>;
}

type RouteContext = { params: Promise<{ matchId: string }> };

function correlationId(request: Request): string {
  const candidate = request.headers.get("x-correlation-id")?.trim();
  return candidate && candidate.length <= 128 ? candidate : randomUUID();
}

export function createMatchGet(cache: MatchCachePort) {
  return async function GET(request: Request, context: RouteContext): Promise<Response> {
    const requestId = correlationId(request);
    try {
      const { matchId } = await context.params;
      const result = await cache.get(matchId);
      const headers = { etag: result.etag, "cache-control": "private, max-age=30", "x-correlation-id": requestId };
      if (request.headers.get("if-none-match") === result.etag) return new Response(null, { status: 304, headers });
      return Response.json({ data: result.view, meta: { correlationId: requestId, source: "product-cache" } }, { status: 200, headers });
    } catch {
      return Response.json({ error: { code: "DATA_UNAVAILABLE", message: "Match cache is temporarily unavailable", correlationId: requestId } }, { status: 503, headers: { "cache-control": "no-store", "x-correlation-id": requestId } });
    }
  };
}

const unavailableCache: MatchCachePort = {
  async get() { throw Object.assign(new Error("Persistent match cache is not configured"), { code: "CACHE_UNAVAILABLE" }); },
};

export const GET = createMatchGet(unavailableCache);
