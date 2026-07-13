import postgres from "postgres";
import { PostgresSettlementCandidateRepository, PostgresSettlementTransactionPort } from "./repository.js";

export function createSettlementPersistence(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 10, prepare: false });
  return {
    transaction: new PostgresSettlementTransactionPort(sql),
    candidates: new PostgresSettlementCandidateRepository(sql),
    close: () => sql.end(),
  };
}
