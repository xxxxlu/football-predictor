import { randomUUID } from "node:crypto";
import { authorizeMatchRead } from "./access";
import { getMatchApiRuntime, type MatchReadAccess } from "./runtime";

export interface MatchListCachePort {
  list(): Promise<{ views: unknown[]; etag: string }>;
}

function correlationId(request: Request): string {
  const candidate = request.headers.get("x-correlation-id")?.trim();
  return candidate && candidate.length <= 128 ? candidate : randomUUID();
}

export function createMatchesGet(cache: MatchListCachePort, access: MatchReadAccess) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = correlationId(request);
    const authorization = await authorizeMatchRead(request, access);
    if (authorization instanceof Response) return authorization;
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

export const GET = (request: Request) => {
  const runtime = getMatchApiRuntime();
  return createMatchesGet(runtime.cache, runtime.access)(request);
};
