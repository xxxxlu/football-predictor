import { loadIdentityConfig } from "@football-predictor/config";
import { createIdentityDatabase, PostgresOperationsRepository } from "@football-predictor/db";
import { getIdentityService } from "../auth/_lib/runtime";
import { createOperationsHandlers } from "./operations-handlers";

declare global { var __footballPredictorOperationsRepository: PostgresOperationsRepository | undefined; }
export function operationsHandlers() {
  if (!globalThis.__footballPredictorOperationsRepository) { const config = loadIdentityConfig(process.env); globalThis.__footballPredictorOperationsRepository = new PostgresOperationsRepository(createIdentityDatabase(config.databaseUrl).sql); }
  return createOperationsHandlers(getIdentityService(), globalThis.__footballPredictorOperationsRepository);
}
