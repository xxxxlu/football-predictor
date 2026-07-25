import { describe, expect, it } from "vitest";
import { createPersistentSupplierJobRunner, type SupplierJobStorePort } from "./persistent-supplier.js";
import type { SupplierJob, SupplierJobResult } from "../supplier/handler.js";
import { JobClaimError } from "@pulse/db";

const now = new Date("2026-07-14T10:00:00.000Z");
const requestedJob: SupplierJob = {
  type: "PREMATCH_ODDS",
  attempt: 1,
  payload: { fixtureId: 101, matchId: "api-football:101", bookmakerId: 8 },
};

function setup(result: SupplierJobResult | Error, claim: Partial<Awaited<ReturnType<SupplierJobStorePort["claim"]>>> = {}) {
  const events: Array<{ name: string; value: unknown }> = [];
  const persistedPayload = { fixtureId: 101, matchId: "api-football:101", bookmakerId: 8 };
  const jobs: SupplierJobStorePort = {
    claim: async (input) => {
      events.push({ name: "claim", value: input });
      return { id: "job-1", jobKey: input.jobKey, payload: persistedPayload, attempt: 2, ...claim };
    },
    complete: async (input) => { events.push({ name: "complete", value: input }); },
    fail: async (input) => { events.push({ name: "fail", value: input }); },
  };
  const received: SupplierJob[] = [];
  const runner = {
    run: async (job: SupplierJob) => {
      received.push(job);
      if (result instanceof Error) throw result;
      return result;
    },
    close: async () => { events.push({ name: "close", value: null }); },
  };
  return {
    persistent: createPersistentSupplierJobRunner({ runner, jobs, clock: { now: () => now } }),
    events,
    received,
  };
}

describe("persistent supplier job adapter", () => {
  it("restores a persisted not-before result after restart without calling the supplier early", async () => {
    const previous: SupplierJobResult = { outcome: "RETRY", reason: "SUPPLIER_FAILURE", retryAt: "2026-07-14T10:01:00.000Z", nextAttempt: 3 };
    const jobs: SupplierJobStorePort = {
      claim: async () => { throw new JobClaimError("JOB_NOT_READY", previous); },
      complete: async () => undefined,
      fail: async () => undefined,
    };
    let supplierCalls = 0;
    const persistent = createPersistentSupplierJobRunner({
      jobs,
      runner: { run: async () => { supplierCalls += 1; return { outcome: "SUCCESS", synced: 0 }; }, close: async () => undefined },
      clock: { now: () => now },
    });

    await expect(persistent.run(requestedJob)).resolves.toEqual(previous);
    expect(supplierCalls).toBe(0);
  });

  it("uses the claimed payload and attempt so a retry cannot mutate its original input", async () => {
    const { persistent, received, events } = setup({ outcome: "SUCCESS", synced: 1 });

    await expect(persistent.run(requestedJob)).resolves.toEqual({ outcome: "SUCCESS", synced: 1 });

    expect(received).toEqual([{ ...requestedJob, attempt: 2 }]);
    expect(events.at(-1)).toEqual({ name: "complete", value: expect.objectContaining({ id: "job-1", status: "SUCCEEDED", finishedAt: now, result: { outcome: "SUCCESS", synced: 1 } }) });
  });

  it("persists retryable supplier failures as failed with their retry time and next attempt", async () => {
    const retry: SupplierJobResult = { outcome: "RETRY", reason: "SUPPLIER_FAILURE", retryAt: "2026-07-14T10:01:00.000Z", nextAttempt: 3 };
    const { persistent, events } = setup(retry);

    await persistent.run(requestedJob);

    expect(events.at(-1)).toEqual({ name: "complete", value: {
      id: "job-1", status: "FAILED", finishedAt: now, availableAt: new Date(retry.retryAt),
      attempt: 3, errorCode: "SUPPLIER_FAILURE", result: retry,
    } });
  });

  it("persists budget deferral as queued rather than a failed supplier call", async () => {
    const deferred: SupplierJobResult = { outcome: "DEFERRED", reason: "PROTECTED_RESERVE", retryAt: "2026-07-15T00:00:00.000Z" };
    const { persistent, events } = setup(deferred);

    await persistent.run(requestedJob);

    expect(events.at(-1)).toEqual({ name: "complete", value: {
      id: "job-1", status: "QUEUED", finishedAt: now, availableAt: new Date(deferred.retryAt),
      attempt: 2, errorCode: "PROTECTED_RESERVE", result: deferred,
    } });
  });

  it("records an unexpected exception reason and rethrows it", async () => {
    const { persistent, events } = setup(new TypeError("socket closed\nwhile reading"));

    await expect(persistent.run(requestedJob)).rejects.toThrow("socket closed");
    expect(events.at(-1)).toEqual({ name: "fail", value: {
      id: "job-1", failedAt: now, errorCode: "TypeError", errorDetail: "socket closed while reading",
    } });
  });
});
