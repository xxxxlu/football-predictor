import { randomUUID } from "node:crypto";
import { ConfigError, loadServerConfig } from "@football-predictor/config";

export function createReadyResponse(
  environment: Record<string, string | undefined>,
  correlationId: string = randomUUID(),
): Response {
  try {
    const config = loadServerConfig(environment);
    return Response.json(
      {
        data: {
          status: "ready",
          version: config.appVersion,
          checks: [{ name: "configuration", status: "ready" }],
          timestamp: new Date().toISOString(),
        },
        meta: { correlationId },
      },
      { status: 200, headers: { "x-correlation-id": correlationId } },
    );
  } catch (error) {
    const invalidKeys = error instanceof ConfigError ? error.invalidKeys : ["environment"];
    return Response.json(
      {
        error: {
          code: "SERVICE_NOT_READY",
          message: "Required application dependencies are not ready",
          details: { checks: [{ name: "configuration", status: "unready", invalidKeys }] },
          correlationId,
        },
      },
      { status: 503, headers: { "x-correlation-id": correlationId } },
    );
  }
}

export function GET(request: Request): Response {
  const candidate = request.headers.get("x-correlation-id")?.trim();
  const correlationId = candidate && candidate.length <= 128 ? candidate : randomUUID();
  return createReadyResponse(process.env, correlationId);
}
