import { loadIdentityConfig } from "@pulse/config";
import { getSharedIdentityDatabase, PostgresOperationsRepository } from "@pulse/db";
import { getIdentityService } from "../auth/_lib/runtime";
import { createOperationsHandlers } from "./operations-handlers";

declare global { var __pulseOperationsRepository: PostgresOperationsRepository | undefined; }
export function operationsHandlers() {
  if (!globalThis.__pulseOperationsRepository) { const config = loadIdentityConfig(process.env); globalThis.__pulseOperationsRepository = new PostgresOperationsRepository(getSharedIdentityDatabase(config.databaseUrl).sql); }
  return createOperationsHandlers(getIdentityService(), globalThis.__pulseOperationsRepository);
}
