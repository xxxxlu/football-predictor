import { loadIdentityConfig } from "@pulse/config";
import { getSharedIdentityDatabase, PostgresOperationsOverviewRepository, PostgresOperationsRepository } from "@pulse/db";
import { getIdentityService } from "../../auth/_lib/runtime";
import { createOperationsOverviewHandlers } from "./handlers";

declare global {
  var __pulseOperationsOverviewRepository: PostgresOperationsOverviewRepository | undefined;
  var __pulseOverviewHealthRepository: PostgresOperationsRepository | undefined;
}

export function operationsOverview() {
  if (!globalThis.__pulseOperationsOverviewRepository) {
    const config = loadIdentityConfig(process.env);
    const { sql } = getSharedIdentityDatabase(config.databaseUrl);
    // The health aggregate is injected rather than reimplemented, so supplier
    // budget, cache freshness and job counts keep one definition — and it still
    // asserts OPERATIONS_HEALTH_READ against the authorization the overview
    // hands it, rather than resolving the same operator row a second time.
    globalThis.__pulseOverviewHealthRepository ??= new PostgresOperationsRepository(sql);
    globalThis.__pulseOperationsOverviewRepository = new PostgresOperationsOverviewRepository(sql, globalThis.__pulseOverviewHealthRepository);
  }
  return globalThis.__pulseOperationsOverviewRepository;
}

export function overviewHandlers() {
  return createOperationsOverviewHandlers(getIdentityService(), operationsOverview());
}
