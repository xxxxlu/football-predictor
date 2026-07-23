import postgres from "postgres";
import { PostgresF1SessionLockPort } from "../f1/session-lock.js";
import { PostgresF1SettlementCandidateRepository } from "../f1/settlement.js";
import { PostgresSettlementCandidateRepository, PostgresSettlementTransactionPort } from "./repository.js";

export function createSettlementPersistence(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 10, prepare: false });
  return {
    transaction: new PostgresSettlementTransactionPort(sql),
    candidates: new PostgresSettlementCandidateRepository(sql),
    f1Candidates: new PostgresF1SettlementCandidateRepository(sql),
    f1SessionLocks: new PostgresF1SessionLockPort(sql),
    close: () => sql.end(),
  };
}
