import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AUDIT_FILTERS,
  auditActionLabel,
  buildAuditQuery,
  cardLabel,
  loadAudit,
  loadFailedJobs,
  loadOverview,
  retryJob,
  severityLabel,
} from "./admin-overview-flow";

const JOB_ID = "11111111-2222-4333-8444-555555555555";

function ok(data: unknown) {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
}
function fail(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "content-type": "application/json" } });
}

describe("audit filter serialization", () => {
  it("sends nothing for the default view", () => {
    expect(buildAuditQuery(DEFAULT_AUDIT_FILTERS)).toBe("");
  });

  it("sends only the filters that narrow the trail", () => {
    const query = buildAuditQuery({ ...DEFAULT_AUDIT_FILTERS, actor: "  ops_admin ", group: "ROLE", result: "SUCCESS" });
    expect(new URLSearchParams(query)).toEqual(new URLSearchParams({ actor: "ops_admin", group: "ROLE", result: "SUCCESS" }));
  });

  it("carries a correlation id on its own, for a jump from a report timeline", () => {
    expect(buildAuditQuery({ ...DEFAULT_AUDIT_FILTERS, correlationId: "audit-1" })).toBe("correlationId=audit-1");
  });

  it("widens a picked day to the whole day, so the end date is not silently lost", () => {
    const query = new URLSearchParams(buildAuditQuery({ ...DEFAULT_AUDIT_FILTERS, from: "2026-07-01", to: "2026-07-30" }));
    expect(query.get("from")).toBe("2026-07-01T00:00:00.000Z");
    expect(query.get("to")).toBe("2026-07-30T23:59:59.999Z");
  });

  it("passes an explicit instant through untouched", () => {
    const query = new URLSearchParams(buildAuditQuery({ ...DEFAULT_AUDIT_FILTERS, from: "2026-07-01T09:30:00.000Z" }));
    expect(query.get("from")).toBe("2026-07-01T09:30:00.000Z");
  });
});

describe("labels", () => {
  it("names every severity and card", () => {
    expect(severityLabel("ACT")).toContain("待处理");
    expect(cardLabel("REPORT_QUEUE")).toBe("治理收件箱");
  });

  it("names the actions from all three audit tables and falls back to the raw code", () => {
    expect(auditActionLabel("OPERATOR_ROLE_GRANTED")).toBe("授予运营职责");
    expect(auditActionLabel("JOB_RETRY_REQUESTED")).toBe("重新排队任务");
    expect(auditActionLabel("INVITE_RESET")).toBe("重置邀请码");
    expect(auditActionLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("reads", () => {
  it("revives the overview timestamps and keeps the server's card list", async () => {
    const fetcher = vi.fn(async () => ok({
      generatedAt: "2026-07-30T10:00:00.000Z", overall: "ACT", capabilities: ["OPERATIONS_HEALTH_READ"],
      sections: [{ card: "JOB_HEALTH", severity: "ACT", metrics: [{ key: "failed", label: "失败任务", value: 1 }], detail: null, nextStep: null }],
    }));
    const overview = await loadOverview(fetcher);
    expect(overview.generatedAt.toISOString()).toBe("2026-07-30T10:00:00.000Z");
    expect(overview.sections).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/admin/overview", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
  });

  it("reports the server's own refusal message", async () => {
    const fetcher = vi.fn(async () => fail(403, "FORBIDDEN", "You do not have permission for this operation."));
    await expect(loadOverview(fetcher)).rejects.toThrow("You do not have permission for this operation.");
  });

  it("appends the audit filters to the request", async () => {
    const fetcher = vi.fn(async () => ok({ events: [] }));
    await loadAudit(fetcher, { ...DEFAULT_AUDIT_FILTERS, group: "TASK", targetType: "JOB" });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/admin/audit?group=TASK&targetType=JOB", expect.anything());
  });

  it("revives audit events without touching their metadata", async () => {
    const metadata = { kind: "supplier:odds", password: "[REDACTED]" };
    const fetcher = vi.fn(async () => ok({ events: [{ id: "audit-1", actor: null, action: "JOB_RETRY_REQUESTED", targetType: "JOB", targetId: JOB_ID, result: "SUCCESS", metadata, occurredAt: "2026-07-30T09:00:00.000Z" }] }));
    const [event] = await loadAudit(fetcher);
    expect(event!.actor).toBeNull();
    expect(event!.metadata).toEqual(metadata);
    expect(event!.occurredAt.toISOString()).toBe("2026-07-30T09:00:00.000Z");
  });

  it("revives the failed task queue", async () => {
    const fetcher = vi.fn(async () => ok({ jobs: [{ id: JOB_ID, kind: "supplier:odds", attempt: 3, runCount: 3, lastErrorCode: "SUPPLIER_TIMEOUT", availableAt: "2026-07-30T09:00:00.000Z", updatedAt: "2026-07-30T09:30:00.000Z" }] }));
    const [job] = await loadFailedJobs(fetcher);
    expect(job).toMatchObject({ id: JOB_ID, kind: "supplier:odds", attempt: 3, lastErrorCode: "SUPPLIER_TIMEOUT" });
    expect(job!.updatedAt).toBeInstanceOf(Date);
  });
});

describe("safe task retry", () => {
  it("confirms identity first, then sends only a job id and a reason", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => (String(input).includes("reauthenticate")
      ? ok({ confirmed: true })
      : ok({ jobId: JOB_ID, status: "QUEUED", availableAt: "2026-07-30T10:00:00.000Z", auditId: "audit-1" })));
    const result = await retryJob(fetcher, { jobId: JOB_ID, reason: "供应商超时，重试一次", password: "correct horse" });
    expect(result.status).toBe("QUEUED");
    expect(fetcher.mock.calls[0]![0]).toBe("/api/v1/auth/reauthenticate");
    const [path, init] = fetcher.mock.calls[1]!;
    expect(path).toBe(`/api/v1/admin/jobs/${JOB_ID}/retry`);
    expect(JSON.parse(String(init?.body))).toEqual({ reason: "供应商超时，重试一次" });
  });

  it("refuses a reason too short to explain itself, before asking for a password", async () => {
    const fetcher = vi.fn(async () => ok({}));
    await expect(retryJob(fetcher, { jobId: JOB_ID, reason: "超时", password: "correct horse" })).rejects.toThrow(/重试理由/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stops at a failed identity confirmation without touching the job", async () => {
    const fetcher = vi.fn(async () => fail(401, "INVALID_CREDENTIALS", "密码不正确"));
    await expect(retryJob(fetcher, { jobId: JOB_ID, reason: "供应商超时，重试一次", password: "wrong" })).rejects.toThrow("密码不正确");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server's refusal when the task is no longer retryable", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => (String(input).includes("reauthenticate")
      ? ok({ confirmed: true })
      : fail(409, "JOB_NOT_RETRYABLE", "Only a failed task can be queued again.")));
    await expect(retryJob(fetcher, { jobId: JOB_ID, reason: "供应商超时，重试一次", password: "correct horse" }))
      .rejects.toThrow("Only a failed task can be queued again.");
  });
});
