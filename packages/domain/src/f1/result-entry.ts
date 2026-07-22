import { validateF1Classification } from "./results.js";
import type { F1ClassificationEntry, F1Session } from "./types.js";

/** Admin entry, confirmation and cancellation of official F1 session results
 *  (§12.5 结算规则). Results are append-only versions: a correction enters a new
 *  version and re-confirms; the settlement worker then reverses and re-settles
 *  every affected ticket against the new version. */

export type F1ResultEntryErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_CANCELLED"
  | "SESSION_NOT_STARTED"
  | "INVALID_CLASSIFICATION"
  | "UNKNOWN_DRIVER"
  | "VERSION_CONFLICT";

export class F1ResultEntryError extends Error {
  constructor(readonly code: F1ResultEntryErrorCode, readonly detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "F1ResultEntryError";
  }
}

export interface F1ResultEntryTransaction {
  getSession(sessionId: string): Promise<F1Session | null>;
  getActiveDriverCodes(): Promise<ReadonlySet<string>>;
  /** Highest entered result version for the session; 0 when none exist. */
  latestResultVersion(sessionId: string): Promise<number>;
  insertResult(record: { sessionId: string; version: number; classification: F1ClassificationEntry[]; enteredBy: string; enteredAt: string }): Promise<void>;
  /** Marks the version as the confirmed result: session result_version/result_confirmed,
   *  state FINISHED, markets closed. Settlement picks the version up asynchronously. */
  markConfirmed(input: { sessionId: string; version: number; confirmedAt: string }): Promise<void>;
  /** Voids the session: state CANCELLED with a confirmed classification-less version,
   *  markets cancelled. Settlement refunds (or reverses then refunds) every ticket. */
  markCancelled(input: { sessionId: string; version: number; occurredAt: string }): Promise<void>;
  appendAudit(event: {
    id: string;
    actorUserId: string;
    action: "F1_RESULT_ENTERED" | "F1_RESULT_CONFIRMED" | "F1_SESSION_CANCELLED";
    targetType: "F1_SESSION";
    targetId: string;
    result: "SUCCESS";
    metadata: Record<string, unknown>;
    occurredAt: string;
  }): Promise<void>;
}

export interface F1ResultEntryTransactionPort {
  /** Runs the callback under a per-session lock so concurrent entries serialize. */
  run<T>(sessionId: string, work: (transaction: F1ResultEntryTransaction) => Promise<T>): Promise<T>;
}

export interface F1ResultEntryClock { now(): Date }
export interface F1ResultEntryIds { next(kind: "audit"): string }

export interface F1ResultReceipt {
  sessionId: string;
  version: number;
  alreadyApplied: boolean;
}

export class F1ResultEntryService {
  private readonly transaction: F1ResultEntryTransactionPort;
  private readonly clock: F1ResultEntryClock;
  private readonly ids: F1ResultEntryIds;

  constructor(input: { transaction: F1ResultEntryTransactionPort; clock: F1ResultEntryClock; ids: F1ResultEntryIds }) {
    this.transaction = input.transaction;
    this.clock = input.clock;
    this.ids = input.ids;
  }

  /** Enters a new draft result version. Confirmation is a separate, explicit step. */
  async enterResult(command: { sessionId: string; classification: F1ClassificationEntry[]; enteredBy: string }): Promise<F1ResultReceipt> {
    return this.transaction.run(command.sessionId, async (transaction) => {
      const session = await this.requireSession(transaction, command.sessionId);
      if (session.state === "CANCELLED") throw new F1ResultEntryError("SESSION_CANCELLED");
      const now = this.clock.now();
      if (now.getTime() < new Date(session.startsAt).getTime()) throw new F1ResultEntryError("SESSION_NOT_STARTED");

      const validation = validateF1Classification(command.classification);
      if (!validation.ok) throw new F1ResultEntryError("INVALID_CLASSIFICATION", validation.reason);
      const entryList = await transaction.getActiveDriverCodes();
      for (const entry of command.classification) {
        if (!entryList.has(entry.driverCode)) throw new F1ResultEntryError("UNKNOWN_DRIVER", entry.driverCode);
      }

      const version = (await transaction.latestResultVersion(command.sessionId)) + 1;
      const enteredAt = now.toISOString();
      await transaction.insertResult({ sessionId: command.sessionId, version, classification: command.classification, enteredBy: command.enteredBy, enteredAt });
      await transaction.appendAudit({
        id: this.ids.next("audit"),
        actorUserId: command.enteredBy,
        action: "F1_RESULT_ENTERED",
        targetType: "F1_SESSION",
        targetId: command.sessionId,
        result: "SUCCESS",
        metadata: { version, entries: command.classification.length },
        occurredAt: enteredAt,
      });
      return { sessionId: command.sessionId, version, alreadyApplied: false };
    });
  }

  /** Confirms the latest entered version. Idempotent: re-confirming the already
   *  confirmed version is a no-op receipt, never a second settlement trigger. */
  async confirmResult(command: { sessionId: string; version: number; confirmedBy: string }): Promise<F1ResultReceipt> {
    return this.transaction.run(command.sessionId, async (transaction) => {
      const session = await this.requireSession(transaction, command.sessionId);
      if (session.state === "CANCELLED") throw new F1ResultEntryError("SESSION_CANCELLED");
      const latest = await transaction.latestResultVersion(command.sessionId);
      if (command.version !== latest || latest === 0) {
        throw new F1ResultEntryError("VERSION_CONFLICT", `latest=${latest}`);
      }
      if (session.resultConfirmed && session.resultVersion === command.version) {
        return { sessionId: command.sessionId, version: command.version, alreadyApplied: true };
      }
      const confirmedAt = this.clock.now().toISOString();
      await transaction.markConfirmed({ sessionId: command.sessionId, version: command.version, confirmedAt });
      await transaction.appendAudit({
        id: this.ids.next("audit"),
        actorUserId: command.confirmedBy,
        action: "F1_RESULT_CONFIRMED",
        targetType: "F1_SESSION",
        targetId: command.sessionId,
        result: "SUCCESS",
        metadata: { version: command.version },
        occurredAt: confirmedAt,
      });
      return { sessionId: command.sessionId, version: command.version, alreadyApplied: false };
    });
  }

  /** Voids a session; already-settled tickets are reversed and refunded by the
   *  settlement worker via the new confirmed version. Idempotent. */
  async cancelSession(command: { sessionId: string; cancelledBy: string; reason: string }): Promise<F1ResultReceipt> {
    return this.transaction.run(command.sessionId, async (transaction) => {
      const session = await this.requireSession(transaction, command.sessionId);
      if (session.state === "CANCELLED") {
        return { sessionId: command.sessionId, version: session.resultVersion ?? 0, alreadyApplied: true };
      }
      const version = (await transaction.latestResultVersion(command.sessionId)) + 1;
      const occurredAt = this.clock.now().toISOString();
      await transaction.markCancelled({ sessionId: command.sessionId, version, occurredAt });
      await transaction.appendAudit({
        id: this.ids.next("audit"),
        actorUserId: command.cancelledBy,
        action: "F1_SESSION_CANCELLED",
        targetType: "F1_SESSION",
        targetId: command.sessionId,
        result: "SUCCESS",
        metadata: { version, reason: command.reason },
        occurredAt,
      });
      return { sessionId: command.sessionId, version, alreadyApplied: false };
    });
  }

  private async requireSession(transaction: F1ResultEntryTransaction, sessionId: string): Promise<F1Session> {
    const session = await transaction.getSession(sessionId);
    if (!session) throw new F1ResultEntryError("SESSION_NOT_FOUND");
    return session;
  }
}
