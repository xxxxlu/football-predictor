import { loadIdentityConfig } from "@pulse/config";
import { getSharedIdentityDatabase, PostgresSettlementAuditRepository } from "@pulse/db";

declare global {
  var __pulseSettlementAuditRepository: PostgresSettlementAuditRepository | undefined;
}

export function getSettlementAuditRepository(): PostgresSettlementAuditRepository {
  if (!globalThis.__pulseSettlementAuditRepository) {
    const config = loadIdentityConfig(process.env);
    const { sql } = getSharedIdentityDatabase(config.databaseUrl);
    globalThis.__pulseSettlementAuditRepository = new PostgresSettlementAuditRepository(sql);
  }
  return globalThis.__pulseSettlementAuditRepository;
}
