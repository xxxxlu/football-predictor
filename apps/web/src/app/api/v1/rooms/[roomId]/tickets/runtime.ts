import { randomUUID } from "node:crypto";
import { loadIdentityConfig } from "@football-predictor/config";
import { createIdentityDatabase, DrizzleTicketSubmissionPort, PostgresSupplierSnapshotAdapter } from "@football-predictor/db";
import { TicketSubmissionService } from "@football-predictor/domain";

declare global { var __footballPredictorTicketSubmissionService: TicketSubmissionService | undefined; }

export function getTicketSubmissionService() {
  if (globalThis.__footballPredictorTicketSubmissionService) return globalThis.__footballPredictorTicketSubmissionService;
  const config = loadIdentityConfig(process.env);
  const { db } = createIdentityDatabase(config.databaseUrl);
  globalThis.__footballPredictorTicketSubmissionService = new TicketSubmissionService({
    transaction: new DrizzleTicketSubmissionPort(db, new PostgresSupplierSnapshotAdapter(db)),
    clock: { now: () => new Date() },
    ids: { next: () => randomUUID() },
  });
  return globalThis.__footballPredictorTicketSubmissionService;
}
