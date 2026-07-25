import { randomUUID } from "node:crypto";
import { ConfigError, loadIdentityConfig, loadServerConfig } from "@pulse/config";
import { expectedMigrations, probeDatabase, type DatabaseProbeFactory } from "./readiness";

type ReadinessDependencies = { migrations(): Promise<string[]>; probe(databaseUrl: string, expected: string[], factory?: DatabaseProbeFactory): ReturnType<typeof probeDatabase> };
const defaults: ReadinessDependencies = { migrations: expectedMigrations, probe: probeDatabase };

export async function createReadyResponse(environment: Record<string, string | undefined>, correlationId: string = randomUUID(), dependencies: ReadinessDependencies = defaults): Promise<Response> {
  try {
    const app = loadServerConfig(environment);
    const identity = loadIdentityConfig(environment);
    const expected = await dependencies.migrations();
    const migrations = await dependencies.probe(identity.databaseUrl, expected);
    return Response.json({ data: { status: "ready", version: app.appVersion, checks: [{ name: "configuration", status: "ready" }, { name: "database", status: "ready" }, { name: "migrations", status: "ready", appliedCount: migrations.appliedCount, latest: migrations.latestApplied }], timestamp: new Date().toISOString() }, meta: { correlationId } }, { status: 200, headers: { "cache-control": "no-store", "x-correlation-id": correlationId } });
  } catch (error) {
    const invalidKeys = error instanceof ConfigError ? error.invalidKeys : undefined;
    return Response.json({ error: { code: "SERVICE_NOT_READY", message: "Required application dependencies are not ready", details: { checks: [{ name: invalidKeys ? "configuration" : "database-and-migrations", status: "unready", ...(invalidKeys ? { invalidKeys } : {}) }] }, correlationId } }, { status: 503, headers: { "cache-control": "no-store", "x-correlation-id": correlationId } });
  }
}

export async function GET(request: Request): Promise<Response> {
  const candidate = request.headers.get("x-correlation-id")?.trim();
  const correlationId = candidate && candidate.length <= 128 ? candidate : randomUUID();
  return createReadyResponse(process.env, correlationId);
}
