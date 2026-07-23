import { JobClaimError, sanitizeJobFailureDetail, supplierJobKey, type JobPayload } from "@football-predictor/db";
import type { SupplierJob, SupplierJobResult } from "../supplier/handler.js";

export interface SupplierJobStorePort {
  claim(input: { jobKey: string; kind: string; payload: JobPayload; attempt: number; requestedAt: Date }): Promise<{
    id: string; jobKey: string; payload: JobPayload; attempt: number;
  }>;
  complete(input: {
    id: string; status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED"; finishedAt: Date;
    availableAt?: Date; attempt: number; errorCode?: string; result: SupplierJobResult;
  }): Promise<void>;
  fail(input: { id: string; failedAt: Date; errorCode: string; errorDetail: string }): Promise<void>;
}

type SupplierRunner = {
  run(job: SupplierJob): Promise<SupplierJobResult>;
  close(): Promise<void>;
};

function errorCode(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function errorDetail(error: unknown): string {
  return sanitizeJobFailureDetail(error instanceof Error ? error.message : String(error));
}

function isSupplierJobResult(value: unknown): value is SupplierJobResult {
  if (typeof value !== "object" || value === null || !("outcome" in value)) return false;
  return value.outcome === "SUCCESS" || value.outcome === "PENDING" || value.outcome === "DEFERRED" || value.outcome === "RETRY";
}

export function createPersistentSupplierJobRunner(input: {
  runner: SupplierRunner;
  jobs: SupplierJobStorePort;
  clock: { now(): Date };
}) {
  return {
    async run(requested: SupplierJob): Promise<SupplierJobResult> {
      const requestedAt = input.clock.now();
      const jobKey = supplierJobKey(requested.type, requested.payload);
      let claim: Awaited<ReturnType<SupplierJobStorePort["claim"]>>;
      try {
        claim = await input.jobs.claim({
          jobKey,
          kind: requested.type,
          payload: requested.payload,
          attempt: requested.attempt,
          requestedAt,
        });
      } catch (error) {
        if (error instanceof JobClaimError && error.code === "JOB_NOT_READY" && isSupplierJobResult(error.previousResult)) {
          return error.previousResult;
        }
        throw error;
      }
      const claimed = { ...requested, payload: claim.payload, attempt: claim.attempt } as SupplierJob;
      try {
        const result = await input.runner.run(claimed);
        const finishedAt = input.clock.now();
        if (result.outcome === "SUCCESS") {
          await input.jobs.complete({ id: claim.id, status: "SUCCEEDED", finishedAt, attempt: claim.attempt, result });
        } else if (result.outcome === "PENDING") {
          // Not a failure: the supplier has not published a lineup yet. Re-queue at the next poll without
          // escalating the retry attempt, and keep the prior cache untouched.
          await input.jobs.complete({
            id: claim.id, status: "QUEUED", finishedAt, availableAt: new Date(result.nextRunAt),
            attempt: claim.attempt, errorCode: result.reason, result,
          });
        } else if (result.outcome === "DEFERRED") {
          await input.jobs.complete({
            id: claim.id, status: "QUEUED", finishedAt, availableAt: new Date(result.retryAt),
            attempt: claim.attempt, errorCode: result.reason, result,
          });
        } else {
          await input.jobs.complete({
            id: claim.id, status: "FAILED", finishedAt, availableAt: new Date(result.retryAt),
            attempt: result.nextAttempt, errorCode: result.reason, result,
          });
        }
        return result;
      } catch (error) {
        await input.jobs.fail({ id: claim.id, failedAt: input.clock.now(), errorCode: errorCode(error), errorDetail: errorDetail(error) });
        throw error;
      }
    },
    close: () => input.runner.close(),
  };
}
