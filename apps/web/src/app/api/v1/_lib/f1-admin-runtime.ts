import { randomUUID } from "node:crypto";
import { loadIdentityConfig } from "@pulse/config";
import { createIdentityDatabase, PostgresF1ResultEntryPort } from "@pulse/db";
import { F1ResultEntryService } from "@pulse/domain";
import { getIdentityService } from "../auth/_lib/runtime";
import { createF1AdminHandlers } from "./f1-admin-handlers";

declare global { var __pulseF1ResultEntryService: F1ResultEntryService | undefined; }

export function f1AdminHandlers() {
  if (!globalThis.__pulseF1ResultEntryService) {
    const config = loadIdentityConfig(process.env);
    globalThis.__pulseF1ResultEntryService = new F1ResultEntryService({
      transaction: new PostgresF1ResultEntryPort(createIdentityDatabase(config.databaseUrl).sql),
      clock: { now: () => new Date() },
      ids: { next: () => randomUUID() },
    });
  }
  return createF1AdminHandlers(getIdentityService(), globalThis.__pulseF1ResultEntryService);
}
