import { randomUUID } from "node:crypto";

function correlationIdFrom(request: Request): string {
  const candidate = request.headers.get("x-correlation-id")?.trim();
  return candidate && candidate.length <= 128 ? candidate : randomUUID();
}

export function GET(request: Request): Response {
  const correlationId = correlationIdFrom(request);
  return Response.json(
    {
      data: {
        status: "live",
        version: process.env.APP_VERSION ?? "development",
        timestamp: new Date().toISOString(),
      },
      meta: { correlationId },
    },
    { status: 200, headers: { "x-correlation-id": correlationId } },
  );
}
