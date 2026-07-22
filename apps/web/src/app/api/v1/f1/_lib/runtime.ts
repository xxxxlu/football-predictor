import { loadIdentityConfig } from "@football-predictor/config";
import { createIdentityDatabase, DrizzleF1Repository } from "@football-predictor/db";
import { F1_SEASON_2026 } from "@football-predictor/domain";
import { getIdentityService } from "../../auth/_lib/runtime";
import { readSessionToken } from "../../auth/_lib/handlers";

declare global { var __footballPredictorF1Repository: DrizzleF1Repository | undefined; }

export function getF1Repository() {
  if (!globalThis.__footballPredictorF1Repository) {
    const config = loadIdentityConfig(process.env);
    globalThis.__footballPredictorF1Repository = new DrizzleF1Repository(createIdentityDatabase(config.databaseUrl).db);
  }
  return globalThis.__footballPredictorF1Repository;
}

export const CURRENT_F1_SEASON = F1_SEASON_2026;

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
