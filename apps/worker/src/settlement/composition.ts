import { randomUUID } from "node:crypto";
import {
  F1SessionLockService,
  SettlementService,
  type F1SessionLockPort,
  type SettlementClock,
  type SettlementIds,
  type SettlementTransactionPort,
} from "@pulse/domain";
import { createSettlementPersistence } from "@pulse/db";
import {
  createSettlementJobHandler,
  createSettlementRetryService,
  type SettlementApplicationPort,
  type SettlementCandidatePort,
} from "./handler.js";
import { createF1SettlementJobHandler, type F1SettlementCandidatePort } from "./f1-handler.js";

export function createSettlementWorkerComposition(input: {
  candidates: SettlementCandidatePort;
  f1Candidates?: F1SettlementCandidatePort;
  f1SessionLocks?: F1SessionLockPort;
  settlement: SettlementApplicationPort;
  clock?: SettlementClock;
  close(): Promise<void>;
}) {
  const handler = createSettlementJobHandler(input);
  const retry = createSettlementRetryService(input);
  const f1 = input.f1Candidates
    ? createF1SettlementJobHandler({ candidates: input.f1Candidates, settlement: input.settlement })
    : null;
  const locks = input.f1SessionLocks
    ? new F1SessionLockService({ port: input.f1SessionLocks, clock: input.clock ?? { now: () => new Date() } })
    : null;
  let closed = false;
  return {
    /** Persistent lock-at-start sweep; absent port → permanent no-op (football-only deploys). */
    async lockDueF1Sessions(limit: number) {
      if (closed) return Promise.reject(new Error("Settlement composition is closed"));
      if (!locks) return { outcome: "SUCCESS" as const, locked: 0, marketsClosed: 0, skipped: 0, failedSessionIds: [] };
      const summary = await locks.run(limit);
      return {
        outcome: summary.outcome,
        locked: summary.locked,
        marketsClosed: summary.marketsClosed,
        skipped: summary.skipped,
        failedSessionIds: summary.failedSessionIds,
      };
    },
    async scan(limit: number) {
      if (closed) return Promise.reject(new Error("Settlement composition is closed"));
      const football = await handler.scan({ limit });
      if (!f1) return football;
      const formula1 = await f1.scan({ limit });
      return {
        outcome: football.outcome === "RETRY" || formula1.outcome === "RETRY" ? "RETRY" as const : "SUCCESS" as const,
        processed: football.processed + formula1.processed,
        held: football.held + formula1.held,
        failedTicketIds: [...football.failedTicketIds, ...formula1.failedTicketIds],
      };
    },
    async retry(ticketId: string) {
      if (closed) return Promise.reject(new Error("Settlement composition is closed"));
      const result = await retry.retry(ticketId);
      // A ticket unknown to the football candidate source may be an F1 ticket.
      if (result.outcome === "NOT_FOUND" && f1) return f1.retry(ticketId);
      return result;
    },
    async close() {
      if (closed) return;
      closed = true;
      await input.close();
    },
  };
}

export function createPostgresSettlementWorkerComposition(input: {
  databaseUrl: string;
  clock?: SettlementClock;
  ids?: SettlementIds;
  createPersistence?: typeof createSettlementPersistence;
}) {
  const clock = input.clock ?? { now: () => new Date() };
  const ids = input.ids ?? { next: () => randomUUID() };
  const persistence = (input.createPersistence ?? createSettlementPersistence)(input.databaseUrl);
  const settlement = new SettlementService({ transaction: persistence.transaction as SettlementTransactionPort, clock, ids });
  return createSettlementWorkerComposition({
    candidates: persistence.candidates,
    ...(persistence.f1Candidates ? { f1Candidates: persistence.f1Candidates } : {}),
    ...(persistence.f1SessionLocks ? { f1SessionLocks: persistence.f1SessionLocks } : {}),
    settlement,
    clock,
    close: persistence.close,
  });
}
