import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";

export type OperationsJobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
export type JobPayload = Readonly<Record<string, unknown>>;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function stableJson(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Job payload numbers must be finite");
    return value;
  }
  if (Array.isArray(value)) return value.map(stableJson);
  if (typeof value === "object") {
    const output: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) output[key] = stableJson(entry);
    }
    return output;
  }
  throw new TypeError("Job payload must be JSON serializable");
}

export function canonicalJobPayload(payload: JobPayload): string {
  return JSON.stringify(stableJson(payload));
}

export function supplierJobKey(kind: string, payload: JobPayload): string {
  const digest = createHash("sha256").update(canonicalJobPayload(payload)).digest("hex");
  return `supplier:${kind}:${digest}`;
}

export function sanitizeJobFailureDetail(detail: string): string {
  return detail.trim().replace(/\s+/g, " ").slice(0, 500);
}

export class JobClaimError extends Error {
  constructor(
    readonly code: "JOB_ALREADY_RUNNING" | "JOB_NOT_READY" | "JOB_CLAIM_CONFLICT",
    readonly previousResult?: unknown,
  ) {
    super(code);
    this.name = "JobClaimError";
  }
}

export interface ClaimedOperationsJob {
  id: string;
  jobKey: string;
  payload: JobPayload;
  attempt: number;
}

type ClaimRow = ClaimedOperationsJob;

export class PostgresOperationsJobRepository {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly clock: { now(): Date } = { now: () => new Date() },
    private readonly id: () => string = randomUUID,
  ) {}

  async claim(input: { jobKey: string; kind: string; payload: JobPayload; attempt: number; requestedAt: Date }): Promise<ClaimedOperationsJob> {
    const now = this.clock.now();
    const staleBefore = new Date(now.getTime() - 15 * 60_000);
    const payload = canonicalJobPayload(input.payload);
    const [row] = await this.sql<ClaimRow[]>`
      INSERT INTO ops.jobs (id,job_key,kind,status,payload,attempt,available_at,started_at,finished_at,last_error_code,last_error_detail,result,run_count,created_at,updated_at)
      VALUES (${this.id()},${input.jobKey},${input.kind},'RUNNING',CAST(${payload} AS jsonb),${Math.max(0, Math.trunc(input.attempt))},${input.requestedAt},${now},NULL,NULL,NULL,NULL,1,${now},${now})
      ON CONFLICT (job_key) WHERE job_key IS NOT NULL DO UPDATE SET
        kind=EXCLUDED.kind,status='RUNNING',
        payload=CASE WHEN ops.jobs.status IN ('QUEUED','FAILED','RUNNING') THEN ops.jobs.payload ELSE EXCLUDED.payload END,
        attempt=CASE WHEN ops.jobs.status IN ('QUEUED','FAILED','RUNNING') THEN ops.jobs.attempt ELSE EXCLUDED.attempt END,
        started_at=EXCLUDED.started_at,finished_at=NULL,last_error_code=NULL,last_error_detail=NULL,result=NULL,
        run_count=ops.jobs.run_count+1,updated_at=EXCLUDED.updated_at
      WHERE (ops.jobs.status IN ('QUEUED','FAILED') AND ops.jobs.available_at<=${now})
         OR (ops.jobs.status='SUCCEEDED' AND ${Math.max(0, Math.trunc(input.attempt))}=0)
         OR (ops.jobs.status='RUNNING' AND ops.jobs.started_at<${staleBefore})
      RETURNING id,job_key AS "jobKey",payload,attempt`;
    if (row) return row;

    const [existing] = await this.sql<Array<{ status: OperationsJobStatus; availableAt: Date | string; result: unknown }>>`
      SELECT status,available_at AS "availableAt",result FROM ops.jobs WHERE job_key=${input.jobKey} LIMIT 1`;
    if (existing?.status === "RUNNING") throw new JobClaimError("JOB_ALREADY_RUNNING");
    if (existing && new Date(existing.availableAt).getTime() > now.getTime()) throw new JobClaimError("JOB_NOT_READY", existing.result);
    throw new JobClaimError("JOB_CLAIM_CONFLICT");
  }

  async complete(input: {
    id: string; status: OperationsJobStatus; finishedAt: Date; availableAt?: Date; attempt: number;
    errorCode?: string; result: unknown;
  }): Promise<void> {
    const availableAt = input.availableAt ?? input.finishedAt;
    const result = JSON.stringify(stableJson(input.result));
    const rows = await this.sql<Array<{ id: string }>>`
      UPDATE ops.jobs SET status=${input.status},available_at=${availableAt},attempt=${Math.max(0, Math.trunc(input.attempt))},
        finished_at=${input.finishedAt},last_error_code=${input.errorCode ?? null},last_error_detail=NULL,
        result=CAST(${result} AS jsonb),updated_at=${input.finishedAt}
      WHERE id=${input.id} AND status='RUNNING' RETURNING id`;
    if (rows.length !== 1) throw new JobClaimError("JOB_CLAIM_CONFLICT");
  }

  async fail(input: { id: string; failedAt: Date; errorCode: string; errorDetail: string }): Promise<void> {
    const rows = await this.sql<Array<{ id: string }>>`
      UPDATE ops.jobs SET status='FAILED',finished_at=${input.failedAt},last_error_code=${input.errorCode},
        last_error_detail=${sanitizeJobFailureDetail(input.errorDetail)},updated_at=${input.failedAt}
      WHERE id=${input.id} AND status='RUNNING' RETURNING id`;
    if (rows.length !== 1) throw new JobClaimError("JOB_CLAIM_CONFLICT");
  }
}
