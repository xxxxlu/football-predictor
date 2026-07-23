import { describe, expect, it } from "vitest";
import {
  F1ResultEntryError,
  F1ResultEntryService,
  type F1ResultEntryTransaction,
  type F1ResultEntryTransactionPort,
} from "./result-entry.js";
import type { F1ClassificationEntry, F1Session } from "./types.js";

const serverTime = new Date("2026-08-02T16:00:00.000Z");

const classification: F1ClassificationEntry[] = [
  { driverCode: "NOR", position: 1, status: "FINISHED", lapsCompleted: 70 },
  { driverCode: "VER", position: 2, status: "FINISHED", lapsCompleted: 70 },
  { driverCode: "STR", position: null, status: "DNS", lapsCompleted: 0 },
];

class FakePort implements F1ResultEntryTransactionPort {
  session: F1Session | null = {
    id: "session-1",
    weekendId: "weekend-1",
    kind: "GRAND_PRIX",
    startsAt: "2026-08-02T13:00:00.000Z",
    state: "UPCOMING",
    resultVersion: null,
    resultConfirmed: false,
  };
  entryList = new Set(["NOR", "VER", "STR"]);
  readonly results: Array<{ sessionId: string; version: number; classification: F1ClassificationEntry[]; enteredBy: string }> = [];
  readonly confirmed: Array<{ sessionId: string; version: number }> = [];
  readonly cancelled: Array<{ sessionId: string; version: number }> = [];
  readonly audits: Array<{ action: string; metadata: Record<string, unknown> }> = [];

  async run<T>(_sessionId: string, work: (transaction: F1ResultEntryTransaction) => Promise<T>): Promise<T> {
    const transaction: F1ResultEntryTransaction = {
      getSession: async () => (this.session ? structuredClone(this.session) : null),
      getActiveDriverCodes: async () => this.entryList,
      latestResultVersion: async (sessionId) => Math.max(
        0,
        ...this.results.filter((record) => record.sessionId === sessionId).map((record) => record.version),
        ...this.cancelled.filter((record) => record.sessionId === sessionId).map((record) => record.version),
      ),
      insertResult: async (record) => { this.results.push(structuredClone(record)); },
      markConfirmed: async (input) => {
        this.confirmed.push({ sessionId: input.sessionId, version: input.version });
        if (this.session) { this.session.resultConfirmed = true; this.session.resultVersion = input.version; this.session.state = "FINISHED"; }
      },
      markCancelled: async (input) => {
        this.cancelled.push({ sessionId: input.sessionId, version: input.version });
        if (this.session) { this.session.state = "CANCELLED"; this.session.resultConfirmed = true; this.session.resultVersion = input.version; }
      },
      appendAudit: async (event) => { this.audits.push({ action: event.action, metadata: event.metadata }); },
    };
    return work(transaction);
  }
}

function setup() {
  const port = new FakePort();
  let id = 0;
  const service = new F1ResultEntryService({
    transaction: port,
    clock: { now: () => serverTime },
    ids: { next: () => `audit-${++id}` },
  });
  return { port, service };
}

async function expectCode(promise: Promise<unknown>, code: F1ResultEntryError["code"]) {
  await expect(promise).rejects.toMatchObject({ name: "F1ResultEntryError", code });
}

describe("F1ResultEntryService.enterResult", () => {
  it("appends versions 1, 2, ... with audit attribution", async () => {
    const { port, service } = setup();
    await expect(service.enterResult({ sessionId: "session-1", classification, enteredBy: "admin-1" }))
      .resolves.toEqual({ sessionId: "session-1", version: 1, alreadyApplied: false });
    await expect(service.enterResult({ sessionId: "session-1", classification, enteredBy: "admin-1" }))
      .resolves.toMatchObject({ version: 2 });
    expect(port.results.map((record) => record.version)).toEqual([1, 2]);
    expect(port.audits.filter((audit) => audit.action === "F1_RESULT_ENTERED")).toHaveLength(2);
  });

  it("rejects unknown sessions, future sessions and cancelled sessions", async () => {
    const missing = setup();
    missing.port.session = null;
    await expectCode(missing.service.enterResult({ sessionId: "nope", classification, enteredBy: "admin-1" }), "SESSION_NOT_FOUND");

    const future = setup();
    future.port.session!.startsAt = "2026-08-02T17:00:00.000Z";
    await expectCode(future.service.enterResult({ sessionId: "session-1", classification, enteredBy: "admin-1" }), "SESSION_NOT_STARTED");

    const voided = setup();
    voided.port.session!.state = "CANCELLED";
    await expectCode(voided.service.enterResult({ sessionId: "session-1", classification, enteredBy: "admin-1" }), "SESSION_CANCELLED");
  });

  it("rejects malformed classifications and drivers outside the entry list", async () => {
    const { service, port } = setup();
    await expectCode(
      service.enterResult({ sessionId: "session-1", classification: [], enteredBy: "admin-1" }),
      "INVALID_CLASSIFICATION",
    );
    await expectCode(
      service.enterResult({
        sessionId: "session-1",
        classification: [{ driverCode: "ZZZ", position: 1, status: "FINISHED", lapsCompleted: 70 }],
        enteredBy: "admin-1",
      }),
      "UNKNOWN_DRIVER",
    );
    expect(port.results).toHaveLength(0);
  });
});

describe("F1ResultEntryService.confirmResult", () => {
  it("confirms only the latest version and is idempotent on repeats", async () => {
    const { port, service } = setup();
    await service.enterResult({ sessionId: "session-1", classification, enteredBy: "admin-1" });
    await service.enterResult({ sessionId: "session-1", classification, enteredBy: "admin-1" });

    await expectCode(service.confirmResult({ sessionId: "session-1", version: 1, confirmedBy: "admin-1" }), "VERSION_CONFLICT");
    await expect(service.confirmResult({ sessionId: "session-1", version: 2, confirmedBy: "admin-1" }))
      .resolves.toEqual({ sessionId: "session-1", version: 2, alreadyApplied: false });
    await expect(service.confirmResult({ sessionId: "session-1", version: 2, confirmedBy: "admin-1" }))
      .resolves.toMatchObject({ alreadyApplied: true });
    expect(port.confirmed).toHaveLength(1);
    expect(port.audits.filter((audit) => audit.action === "F1_RESULT_CONFIRMED")).toHaveLength(1);
  });

  it("rejects confirmation when no version was entered", async () => {
    const { service } = setup();
    await expectCode(service.confirmResult({ sessionId: "session-1", version: 0, confirmedBy: "admin-1" }), "VERSION_CONFLICT");
  });

  it("supports a correction cycle: enter v1, confirm, enter v2, confirm v2", async () => {
    const { port, service } = setup();
    await service.enterResult({ sessionId: "session-1", classification, enteredBy: "admin-1" });
    await service.confirmResult({ sessionId: "session-1", version: 1, confirmedBy: "admin-1" });
    await service.enterResult({ sessionId: "session-1", classification, enteredBy: "admin-2" });
    await expect(service.confirmResult({ sessionId: "session-1", version: 2, confirmedBy: "admin-2" }))
      .resolves.toMatchObject({ version: 2, alreadyApplied: false });
    expect(port.confirmed.map((record) => record.version)).toEqual([1, 2]);
  });
});

describe("F1ResultEntryService.cancelSession", () => {
  it("voids the session once with a fresh confirmed version, then no-ops", async () => {
    const { port, service } = setup();
    await service.enterResult({ sessionId: "session-1", classification, enteredBy: "admin-1" });
    await service.confirmResult({ sessionId: "session-1", version: 1, confirmedBy: "admin-1" });

    await expect(service.cancelSession({ sessionId: "session-1", cancelledBy: "admin-1", reason: "red flag void" }))
      .resolves.toEqual({ sessionId: "session-1", version: 2, alreadyApplied: false });
    await expect(service.cancelSession({ sessionId: "session-1", cancelledBy: "admin-1", reason: "again" }))
      .resolves.toMatchObject({ alreadyApplied: true });
    expect(port.cancelled).toHaveLength(1);
    expect(port.audits.at(-1)?.action).toBe("F1_SESSION_CANCELLED");
  });
});
