import { randomUUID } from "node:crypto";
import { loadIdentityConfig } from "@football-predictor/config";
import { createIdentityDatabase, PostgresF1ResultEntryPort } from "@football-predictor/db";
import { F1ResultEntryService } from "@football-predictor/domain";
import { getIdentityService } from "../auth/_lib/runtime";
import { createF1AdminHandlers } from "./f1-admin-handlers";

declare global { var __footballPredictorF1ResultEntryService: F1ResultEntryService | undefined; }

export function f1AdminHandlers() {
  if (!globalThis.__footballPredictorF1ResultEntryService) {
    const config = loadIdentityConfig(process.env);
    globalThis.__footballPredictorF1ResultEntryService = new F1ResultEntryService({
      transaction: new PostgresF1ResultEntryPort(createIdentityDatabase(config.databaseUrl).sql),
      clock: { now: () => new Date() },
      ids: { next: () => randomUUID() },
    });
  }
  return createF1AdminHandlers(getIdentityService(), globalThis.__footballPredictorF1ResultEntryService);
}
