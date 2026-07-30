import { AuthError, OVERVIEW_CAPABILITIES } from "@pulse/domain";
import { OperationError } from "@pulse/db";
import { describe, expect, it, vi } from "vitest";
import { createOperationsOverviewHandlers } from "./handlers";

const ORIGIN = "https://pulse.test";

function request(path: string, init: RequestInit & { session?: string; proof?: string; origin?: string | null } = {}) {
  const cookies = [init.session === undefined ? "fp_session=session-token" : init.session ? `fp_session=${init.session}` : "", init.proof ? `fp_reauth=${init.proof}` : ""].filter(Boolean).join("; ");
  const headers = new Headers(init.headers);
  if (cookies) headers.set("cookie", cookies);
  if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  headers.set("content-type", "application/json");
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

function identity(overrides: Partial<{ requireCapability: unknown; authorizeCapabilityAction: unknown }> = {}) {
  return {
    requireCapability: vi.fn(async () => ({ id: "operator-1" })),
    authorizeCapabilityAction: vi.fn(async () => ({ id: "operator-1" })),
    ...overrides,
  };
}

function operations(overrides: Record<string, unknown> = {}) {
  return {
    overview: vi.fn(async () => ({ overall: "OK", sections: [] })),
    listFailedJobs: vi.fn(async () => []),
    listAudit: vi.fn(async () => []),
    retryJob: vi.fn(async () => ({ jobId: JOB_ID, status: "QUEUED" })),
    ...overrides,
  };
}

/** The stubs are structural stand-ins; the handlers only ever call these members. */
const handlersFor = (identityStub: ReturnType<typeof identity>, operationsStub: ReturnType<typeof operations>): ReturnType<typeof createOperationsOverviewHandlers> =>
  createOperationsOverviewHandlers(identityStub as never, operationsStub as never);

const JOB_ID = "11111111-2222-4333-8444-555555555555";
const REASON = "供应商超时，重试一次";
const forbidden = () => { throw new AuthError("FORBIDDEN", 403, "You do not have permission for this operation."); };

describe("operations overview route", () => {
  it("admits an account holding any one operational read duty", async () => {
    // A community moderator holds only ROOM_REPORT_READ, which is the fourth
    // candidate — the route must keep trying rather than refuse on the first miss.
    const identityStub = identity({
      requireCapability: vi.fn(async (_token: string, capability: string) => {
        if (capability !== "ROOM_REPORT_READ") forbidden();
        return { id: "mod-1" };
      }),
    });
    const operationsStub = operations();
    const response = await handlersFor(identityStub, operationsStub).overview(request("/api/v1/admin/overview"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(operationsStub.overview).toHaveBeenCalledWith("mod-1");
  });

  it("refuses an account with no operational duty at all", async () => {
    const identityStub = identity({ requireCapability: vi.fn(async () => forbidden()) });
    const operationsStub = operations();
    const response = await handlersFor(identityStub, operationsStub).overview(request("/api/v1/admin/overview"));
    expect(response.status).toBe(403);
    expect(identityStub.requireCapability).toHaveBeenCalledTimes(OVERVIEW_CAPABILITIES.length);
    expect(operationsStub.overview).not.toHaveBeenCalled();
  });

  it("reports an expired session as unauthenticated rather than trying the next duty", async () => {
    const identityStub = identity({
      requireCapability: vi.fn(async () => { throw new AuthError("SESSION_EXPIRED", 401, "Log in again to continue."); }),
    });
    const response = await handlersFor(identityStub, operations()).overview(request("/api/v1/admin/overview"));
    expect(response.status).toBe(401);
    expect(identityStub.requireCapability).toHaveBeenCalledTimes(1);
  });

  it("refuses a request with no session before touching the repository", async () => {
    const operationsStub = operations();
    const response = await handlersFor(identity(), operationsStub).overview(request("/api/v1/admin/overview", { session: "" }));
    expect(response.status).toBe(401);
    expect(operationsStub.overview).not.toHaveBeenCalled();
  });
});

describe("failed task queue route", () => {
  it("gates the queue on the health capability", async () => {
    const identityStub = identity();
    const operationsStub = operations();
    const response = await handlersFor(identityStub, operationsStub).failedJobs(request("/api/v1/admin/jobs"));
    expect(response.status).toBe(200);
    expect(identityStub.requireCapability).toHaveBeenCalledWith("session-token", "OPERATIONS_HEALTH_READ");
    expect(operationsStub.listFailedJobs).toHaveBeenCalledWith("operator-1");
  });

  it("refuses a duty that cannot read operational health", async () => {
    const response = await handlersFor(identity({ requireCapability: vi.fn(async () => forbidden()) }), operations()).failedJobs(request("/api/v1/admin/jobs"));
    expect(response.status).toBe(403);
  });
});

describe("audit route", () => {
  it("gates the trail on AUDIT_READ and forwards the parsed filters", async () => {
    const identityStub = identity();
    const operationsStub = operations();
    const response = await handlersFor(identityStub, operationsStub).audit(
      request("/api/v1/admin/audit?actor=Ops_Admin&group=ROLE&action=OPERATOR_ROLE_GRANTED&targetType=USER&result=SUCCESS&from=2026-07-01T00:00:00.000Z&limit=25"),
    );
    expect(response.status).toBe(200);
    expect(identityStub.requireCapability).toHaveBeenCalledWith("session-token", "AUDIT_READ");
    expect(operationsStub.listAudit).toHaveBeenCalledWith("operator-1", expect.objectContaining({
      actor: "ops_admin", group: "ROLE", action: "OPERATOR_ROLE_GRANTED", targetType: "USER", result: "SUCCESS", limit: 25,
    }));
    const body = await response.json() as { data: { query: { from: string | null }; events: unknown[] } };
    // The applied filters are echoed so the client can trust its own state.
    expect(body.data.query.from).toBe("2026-07-01T00:00:00.000Z");
  });

  it("treats no query string as the whole trail", async () => {
    const operationsStub = operations();
    const response = await handlersFor(identity(), operationsStub).audit(request("/api/v1/admin/audit"));
    expect(response.status).toBe(200);
    expect(operationsStub.listAudit).toHaveBeenCalledWith("operator-1", expect.objectContaining({ group: "ALL", action: "", targetType: "ALL", from: null, to: null }));
  });

  it("refuses an unknown filter value without querying anything", async () => {
    const identityStub = identity();
    const operationsStub = operations();
    for (const query of ["?targetType=LEDGER", "?action=LEDGER_ADJUSTED", "?group=ROLE&action=ROOM_CLOSE", "?from=yesterday", "?correlationId=42"]) {
      const response = await handlersFor(identityStub, operationsStub).audit(request(`/api/v1/admin/audit${query}`));
      expect(response.status).toBe(422);
    }
    expect(operationsStub.listAudit).not.toHaveBeenCalled();
  });

  it("authorizes before it validates, so a stranger learns nothing about the vocabulary", async () => {
    // A 422 tells the caller their value was a recognised filter name with an
    // unrecognised value. Nobody without AUDIT_READ gets to find that out.
    const identityStub = identity({ requireCapability: vi.fn(async () => forbidden()) });
    const operationsStub = operations();
    const response = await handlersFor(identityStub, operationsStub).audit(request("/api/v1/admin/audit?targetType=LEDGER"));
    expect(response.status).toBe(403);
    expect(operationsStub.listAudit).not.toHaveBeenCalled();
  });

  it("refuses a restricted duty that cannot read the audit trail", async () => {
    const response = await handlersFor(identity({ requireCapability: vi.fn(async () => forbidden()) }), operations()).audit(request("/api/v1/admin/audit"));
    expect(response.status).toBe(403);
  });
});

describe("safe task retry route", () => {
  const body = JSON.stringify({ reason: REASON });

  it("requires the retry duty, a fresh proof and a written reason", async () => {
    const identityStub = identity();
    const operationsStub = operations();
    const response = await handlersFor(identityStub, operationsStub).retryJob(request(`/api/v1/admin/jobs/${JOB_ID}/retry`, { method: "POST", body, proof: "proof-token" }), JOB_ID);
    expect(response.status).toBe(200);
    expect(identityStub.authorizeCapabilityAction).toHaveBeenCalledWith({ sessionToken: "session-token", proofToken: "proof-token", capability: "OPERATIONS_TASK_RETRY" });
    expect(operationsStub.retryJob).toHaveBeenCalledWith("operator-1", JOB_ID, REASON);
  });

  it("refuses a retry with no re-auth proof", async () => {
    const identityStub = identity();
    const operationsStub = operations();
    const response = await handlersFor(identityStub, operationsStub).retryJob(request(`/api/v1/admin/jobs/${JOB_ID}/retry`, { method: "POST", body }), JOB_ID);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "REAUTH_REQUIRED" } });
    expect(identityStub.authorizeCapabilityAction).not.toHaveBeenCalled();
    expect(operationsStub.retryJob).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin retry", async () => {
    const operationsStub = operations();
    const response = await handlersFor(identity(), operationsStub).retryJob(
      request(`/api/v1/admin/jobs/${JOB_ID}/retry`, { method: "POST", body, proof: "proof-token", origin: "https://evil.test" }), JOB_ID);
    expect(response.status).toBe(403);
    expect(operationsStub.retryJob).not.toHaveBeenCalled();
  });

  it("refuses a retry with no reason, or one too short to explain itself", async () => {
    const operationsStub = operations();
    for (const payload of ["{}", JSON.stringify({ reason: "超时" }), JSON.stringify({ reason: REASON, force: true })]) {
      const response = await handlersFor(identity(), operationsStub).retryJob(
        request(`/api/v1/admin/jobs/${JOB_ID}/retry`, { method: "POST", body: payload, proof: "proof-token" }), JOB_ID);
      expect(response.status).toBe(422);
    }
    expect(operationsStub.retryJob).not.toHaveBeenCalled();
  });

  it("establishes the identity before it reads the body", async () => {
    // A caller with no proof gets the re-auth refusal, not a schema critique of a
    // body the server should never have parsed on their behalf.
    const operationsStub = operations();
    const response = await handlersFor(identity(), operationsStub).retryJob(
      request(`/api/v1/admin/jobs/${JOB_ID}/retry`, { method: "POST", body: "not json at all" }), JOB_ID);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "REAUTH_REQUIRED" } });
    expect(operationsStub.retryJob).not.toHaveBeenCalled();
  });

  it("refuses a malformed job id as not found", async () => {
    const operationsStub = operations();
    const response = await handlersFor(identity(), operationsStub).retryJob(
      request("/api/v1/admin/jobs/not-a-uuid/retry", { method: "POST", body, proof: "proof-token" }), "not-a-uuid");
    expect(response.status).toBe(404);
    expect(operationsStub.retryJob).not.toHaveBeenCalled();
  });

  it("passes a repository refusal through with its own code", async () => {
    const operationsStub = operations({ retryJob: vi.fn(async () => { throw new OperationError("JOB_NOT_RETRYABLE", 409); }) });
    const response = await handlersFor(identity(), operationsStub).retryJob(
      request(`/api/v1/admin/jobs/${JOB_ID}/retry`, { method: "POST", body, proof: "proof-token" }), JOB_ID);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "JOB_NOT_RETRYABLE" } });
  });

  it("accepts no field that could redirect the work", async () => {
    // FR59: a retry repeats existing work. Anything that could change *what* runs
    // — a payload, an odds version, a settlement target — is refused by the schema.
    const operationsStub = operations();
    for (const payload of [{ reason: REASON, payload: {} }, { reason: REASON, oddsVersion: "v2" }, { reason: REASON, attempt: 0 }]) {
      const response = await handlersFor(identity(), operationsStub).retryJob(
        request(`/api/v1/admin/jobs/${JOB_ID}/retry`, { method: "POST", body: JSON.stringify(payload), proof: "proof-token" }), JOB_ID);
      expect(response.status).toBe(422);
    }
  });
});
