import { randomUUID } from "node:crypto";
import { SettlementService, type SettlementClock, type SettlementIds, type SettlementTransactionPort } from "@football-predictor/domain";
import { createSettlementPersistence } from "@football-predictor/db";
import {
  createSettlementJobHandler,
  createSettlementRetryService,
  type SettlementApplicationPort,
  type SettlementCandidatePort,
} from "./handler.js";

export function createSettlementWorkerComposition(input: {
  candidates: SettlementCandidatePort;
  settlement: SettlementApplicationPort;
  close(): Promise<void>;
}) {
  const handler = createSettlementJobHandler(input);
  const retry = createSettlementRetryService(input);
  let closed = false;
  return {
    scan(limit: number) {
      if (closed) return Promise.reject(new Error("Settlement composition is closed"));
      return handler.scan({ limit });
    },
    retry(ticketId: string) {
      if (closed) return Promise.reject(new Error("Settlement composition is closed"));
      return retry.retry(ticketId);
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
  return createSettlementWorkerComposition({ candidates: persistence.candidates, settlement, close: persistence.close });
}
