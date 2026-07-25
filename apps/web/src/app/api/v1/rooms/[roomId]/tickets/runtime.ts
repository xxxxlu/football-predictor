import { randomUUID } from "node:crypto";
import { loadIdentityConfig } from "@pulse/config";
import { createIdentityDatabase, DrizzleTicketSubmissionPort, F1MarketSnapshotAdapter, PostgresSupplierSnapshotAdapter, SportDispatchingSnapshotAdapter } from "@pulse/db";
import { TicketSubmissionService } from "@pulse/domain";

declare global { var __pulseTicketSubmissionService: TicketSubmissionService | undefined; }

export function getTicketSubmissionService() {
  if (globalThis.__pulseTicketSubmissionService) return globalThis.__pulseTicketSubmissionService;
  const config = loadIdentityConfig(process.env);
  const { db } = createIdentityDatabase(config.databaseUrl);
  globalThis.__pulseTicketSubmissionService = new TicketSubmissionService({
    transaction: new DrizzleTicketSubmissionPort(db, new SportDispatchingSnapshotAdapter(
      new PostgresSupplierSnapshotAdapter(db),
      new F1MarketSnapshotAdapter(db),
    )),
    clock: { now: () => new Date() },
    ids: { next: () => randomUUID() },
  });
  return globalThis.__pulseTicketSubmissionService;
}
