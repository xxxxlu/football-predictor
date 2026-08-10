import { loadIdentityConfig } from "@pulse/config";
import { DrizzleF1Repository, getSharedIdentityDatabase, refreshF1ReadModelIfDue } from "@pulse/db";
import { F1_SEASON_2026 } from "@pulse/domain";
import { getIdentityService } from "../../auth/_lib/runtime";
import { readSessionToken } from "../../auth/_lib/handlers";

declare global { var __pulseF1Repository: DrizzleF1Repository | undefined; }

export function getF1Repository() {
  if (!globalThis.__pulseF1Repository) {
    const config = loadIdentityConfig(process.env);
    globalThis.__pulseF1Repository = new DrizzleF1Repository(getSharedIdentityDatabase(config.databaseUrl).db);
  }
  return globalThis.__pulseF1Repository;
}

export const CURRENT_F1_SEASON = F1_SEASON_2026;

/**
 * Production CloudBase has no resident worker. Keep F1 result/standings reads
 * current from the page API while the DB-backed claim limits supplier traffic to
 * one refresh every five minutes across all function instances.
 */
export async function refreshF1ReadModel(): Promise<void> {
  if (process.env.F1_RESULTS_SYNC_ENABLED === "false") return;
  try {
    const config = loadIdentityConfig(process.env);
    const season = Number.parseInt(process.env.F1_RESULTS_SEASON ?? String(CURRENT_F1_SEASON), 10);
    if (!Number.isInteger(season) || season < 2000 || season > 2100) return;
    await refreshF1ReadModelIfDue({
      databaseUrl: config.databaseUrl,
      season,
      baseUrl: process.env.JOLPICA_BASE_URL,
      minimumIntervalMs: 5 * 60_000,
    });
  } catch (error) {
    // A temporary source failure must never make already-confirmed F1 results
    // unreadable. The next eligible read retries after the bounded interval.
    console.warn("f1.read_model_refresh_failed", error);
  }
}

/** All F1 reads require a logged-in account, matching the football matches API. */
export async function authorizeF1Read(request: Request): Promise<{ userId: string } | Response> {
  const token = readSessionToken(request);
  const account = token ? await getIdentityService().authenticate(token) : null;
  if (!account) {
    return Response.json(
      { error: { code: "UNAUTHENTICATED", message: "Log in to continue." } },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  return { userId: account.id };
}

export function f1Json(data: unknown): Response {
  return Response.json({ data }, { status: 200, headers: { "cache-control": "private, max-age=30" } });
}

export function f1Failure(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
}
