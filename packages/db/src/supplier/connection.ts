import postgres from "postgres";
import { PostgresSupplierBudget } from "./budget.js";
import { PostgresMatchSnapshotRepository } from "./repository.js";
import { PostgresOperationsJobRepository } from "../operations/jobs.js";

export function createSupplierPersistence(databaseUrl: string, clock: { now(): Date } = { now: () => new Date() }) {
  const sql = postgres(databaseUrl, { max: 10, prepare: false });
  return {
    budget: new PostgresSupplierBudget(sql),
    repository: new PostgresMatchSnapshotRepository(sql, clock),
    jobs: new PostgresOperationsJobRepository(sql, clock),
    close: () => sql.end(),
  };
}
