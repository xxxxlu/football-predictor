import { AuthError } from "@pulse/domain";
import { OperationError } from "@pulse/db";
import { describe, expect, it, vi } from "vitest";
import { createGovernanceInboxHandlers, createGovernanceNoticeHandlers } from "./handlers";

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

function inbox(overrides: Record<string, unknown> = {}) {
  return {
    listReports: vi.fn(async () => []),
    getReport: vi.fn(async () => ({ reportId: "report-1" })),
    triageReport: vi.fn(async () => ({ reportId: "report-1", status: "ASSIGNED" })),
    resolveReport: vi.fn(async () => ({ reportId: "report-1", status: "RESOLVED" })),
    liftMute: vi.fn(async () => ({ reportId: "report-1", lifted: true })),
    ...overrides,
  };
}

/** The stubs are structural stand-ins; the handlers only ever call these members. */
const handlersFor = (identityStub: ReturnType<typeof identity>, inboxStub: ReturnType<typeof inbox>) =>
  createGovernanceInboxHandlers(identityStub as never, inboxStub as never);

const REPORT_ID = "11111111-2222-4333-8444-555555555555";
const forbidden = () => { throw new AuthError("FORBIDDEN", 403, "You do not have permission for this operation."); };

describe("governance inbox routes", () => {
  it("gates the queue on the shared inbox capability and forwards the parsed filters", async () => {
    const identityStub = identity();
    const inboxStub = inbox();
    const handlers = handlersFor(identityStub, inboxStub);
    const response = await handlers.list(request("/api/v1/admin/governance/reports?kind=MESSAGE&status=OPEN&severity=HIGH&assignee=ME&limit=25"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(identityStub.requireCapability).toHaveBeenCalledWith("session-token", "ROOM_REPORT_READ");
    expect(inboxStub.listReports).toHaveBeenCalledWith("operator-1", { kind: "MESSAGE", status: "OPEN", severity: "HIGH", assignee: "ME", limit: 25 });
  });

  it("refuses an unknown filter value without authorizing or querying anything", async () => {
    const identityStub = identity();
    const inboxStub = inbox();
    const handlers = handlersFor(identityStub, inboxStub);
    const response = await handlers.list(request("/api/v1/admin/governance/reports?severity=URGENT"));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(identityStub.requireCapability).not.toHaveBeenCalled();
    expect(inboxStub.listReports).not.toHaveBeenCalled();
  });

  it("refuses every route without a session", async () => {
    const handlers = handlersFor(identity(), inbox());
    const calls = [
      handlers.list(request("/api/v1/admin/governance/reports", { session: "" })),
      handlers.detail(request(`/api/v1/admin/governance/reports/${REPORT_ID}`, { session: "" }), REPORT_ID),
      handlers.triage(request(`/api/v1/admin/governance/reports/${REPORT_ID}/triage`, { method: "PATCH", session: "", body: JSON.stringify({ assign: "ME" }) }), REPORT_ID),
      handlers.resolve(request(`/api/v1/admin/governance/reports/${REPORT_ID}/resolution`, { method: "POST", session: "", proof: "proof-token", body: JSON.stringify({ disposition: "DISMISS", reason: "无需处理，予以驳回" }) }), REPORT_ID),
    ];
    for (const response of await Promise.all(calls)) {
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    }
  });

  it("refuses a read to an operator with no report duty", async () => {
    const handlers = handlersFor(identity({ requireCapability: vi.fn(forbidden) }), inbox());
    for (const response of await Promise.all([
      handlers.list(request("/api/v1/admin/governance/reports")),
      handlers.detail(request(`/api/v1/admin/governance/reports/${REPORT_ID}`), REPORT_ID),
    ])) {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "FORBIDDEN" } });
    }
  });

  it("demands a fresh re-auth proof for every disposition", async () => {
    const inboxStub = inbox();
    const handlers = handlersFor(identity(), inboxStub);
    const calls = [
      handlers.resolve(request(`/api/v1/admin/governance/reports/${REPORT_ID}/resolution`, { method: "POST", body: JSON.stringify({ disposition: "CLOSE_ROOM", reason: "反复违规拉人" }) }), REPORT_ID),
      handlers.liftMute(request(`/api/v1/admin/governance/reports/${REPORT_ID}/mute-lift`, { method: "POST", body: JSON.stringify({ reason: "复核后解除禁言" }) }), REPORT_ID),
    ];
    for (const response of await Promise.all(calls)) {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "REAUTH_REQUIRED" } });
    }
    expect(inboxStub.resolveReport).not.toHaveBeenCalled();
    expect(inboxStub.liftMute).not.toHaveBeenCalled();
  });

  it("accepts a disposition from either governance duty and passes the trimmed reason on", async () => {
    // A community moderator holds no ROOM_GOVERNANCE_WRITE, so the first candidate
    // duty is refused and the second is what authorizes the write.
    const authorizeCapabilityAction = vi.fn(async ({ capability }: { capability: string }) => {
      if (capability === "ROOM_GOVERNANCE_WRITE") return forbidden();
      return { id: "moderator-1" };
    });
    const inboxStub = inbox();
    const handlers = handlersFor(identity({ authorizeCapabilityAction }), inboxStub);
    const response = await handlers.resolve(request(`/api/v1/admin/governance/reports/${REPORT_ID}/resolution`, {
      method: "POST", proof: "proof-token", body: JSON.stringify({ disposition: "MUTE_MEMBER", reason: "  连续辱骂其他成员  ", muteHours: 24 }),
    }), REPORT_ID);
    expect(response.status).toBe(200);
    expect(inboxStub.resolveReport).toHaveBeenCalledWith("moderator-1", REPORT_ID, { disposition: "MUTE_MEMBER", reason: "连续辱骂其他成员", muteHours: 24 });
  });

  it("keeps an expired proof a re-auth problem instead of reporting it as a permission problem", async () => {
    const authorizeCapabilityAction = vi.fn(async () => { throw new AuthError("REAUTH_REQUIRED", 403, "Confirm your password again before this operation."); });
    const handlers = handlersFor(identity({ authorizeCapabilityAction }), inbox());
    const response = await handlers.resolve(request(`/api/v1/admin/governance/reports/${REPORT_ID}/resolution`, {
      method: "POST", proof: "stale-proof", body: JSON.stringify({ disposition: "DISMISS", reason: "无需处理，予以驳回" }),
    }), REPORT_ID);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "REAUTH_REQUIRED" } });
    // One attempt per candidate duty, and the first failure is not swallowed.
    expect(authorizeCapabilityAction).toHaveBeenCalledTimes(1);
  });

  it("refuses a disposition to an operator who holds neither governance write duty", async () => {
    const handlers = handlersFor(identity({ authorizeCapabilityAction: vi.fn(forbidden) }), inbox());
    const response = await handlers.resolve(request(`/api/v1/admin/governance/reports/${REPORT_ID}/resolution`, {
      method: "POST", proof: "proof-token", body: JSON.stringify({ disposition: "DISMISS", reason: "无需处理，予以驳回" }),
    }), REPORT_ID);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("requires a reason on every disposition and rejects an unknown field", async () => {
    const inboxStub = inbox();
    const handlers = handlersFor(identity(), inboxStub);
    const bodies = [
      { disposition: "CLOSE_ROOM" },
      { disposition: "CLOSE_ROOM", reason: "短话" },
      { disposition: "CLOSE_ROOM", reason: "x".repeat(501) },
      { disposition: "BAN_FOREVER", reason: "越权动作尝试" },
      { disposition: "CLOSE_ROOM", reason: "反复违规拉人", roomId: "room-1" },
      { disposition: "MUTE_MEMBER", reason: "连续辱骂成员", muteHours: 5000 },
    ];
    for (const body of bodies) {
      const response = await handlers.resolve(request(`/api/v1/admin/governance/reports/${REPORT_ID}/resolution`, { method: "POST", proof: "proof-token", body: JSON.stringify(body) }), REPORT_ID);
      expect(response.status, JSON.stringify(body)).toBe(422);
    }
    expect(inboxStub.resolveReport).not.toHaveBeenCalled();
  });

  it("claims a report with the duty alone — no proof, no reason", async () => {
    const identityStub = identity();
    const inboxStub = inbox();
    const handlers = handlersFor(identityStub, inboxStub);
    const response = await handlers.triage(request(`/api/v1/admin/governance/reports/${REPORT_ID}/triage`, { method: "PATCH", body: JSON.stringify({ assign: "ME", severity: "HIGH" }) }), REPORT_ID);
    expect(response.status).toBe(200);
    expect(inboxStub.triageReport).toHaveBeenCalledWith("operator-1", REPORT_ID, { assign: "ME", severity: "HIGH" });
    expect(identityStub.authorizeCapabilityAction).not.toHaveBeenCalled();

    // An empty triage body changes nothing and is refused rather than audited.
    const empty = await handlers.triage(request(`/api/v1/admin/governance/reports/${REPORT_ID}/triage`, { method: "PATCH", body: JSON.stringify({}) }), REPORT_ID);
    expect(empty.status).toBe(422);
  });

  it("refuses a cross-origin write before anything else", async () => {
    const identityStub = identity();
    const inboxStub = inbox();
    const handlers = handlersFor(identityStub, inboxStub);
    const response = await handlers.resolve(request(`/api/v1/admin/governance/reports/${REPORT_ID}/resolution`, {
      method: "POST", proof: "proof-token", origin: "https://evil.test", body: JSON.stringify({ disposition: "DISMISS", reason: "无需处理，予以驳回" }),
    }), REPORT_ID);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(inboxStub.resolveReport).not.toHaveBeenCalled();
    expect(identityStub.authorizeCapabilityAction).not.toHaveBeenCalled();
  });

  it("treats a malformed report id as not found rather than passing it to the database", async () => {
    const inboxStub = inbox();
    const handlers = handlersFor(identity(), inboxStub);
    const response = await handlers.detail(request("/api/v1/admin/governance/reports/not-a-uuid"), "not-a-uuid");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "REPORT_NOT_FOUND" } });
    expect(inboxStub.getReport).not.toHaveBeenCalled();
  });

  it("maps repository conflicts onto their own codes", async () => {
    const cases = [
      [new OperationError("REPORT_ALREADY_CLOSED", 409), 409, "REPORT_ALREADY_CLOSED"],
      [new OperationError("MESSAGE_NOT_HIDDEN", 409), 409, "MESSAGE_NOT_HIDDEN"],
      [new OperationError("MUTE_ALREADY_ACTIVE", 409), 409, "MUTE_ALREADY_ACTIVE"],
      [new OperationError("REPORT_NOT_FOUND", 404), 404, "REPORT_NOT_FOUND"],
      [new AuthError("INVALID_REQUEST", 422, "That action does not apply to this report."), 422, "INVALID_REQUEST"],
    ] as const;
    for (const [error, status, code] of cases) {
      const handlers = handlersFor(identity(), inbox({ resolveReport: vi.fn(async () => { throw error; }) }));
      const response = await handlers.resolve(request(`/api/v1/admin/governance/reports/${REPORT_ID}/resolution`, {
        method: "POST", proof: "proof-token", body: JSON.stringify({ disposition: "DISMISS", reason: "无需处理，予以驳回" }),
      }), REPORT_ID);
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ error: { code } });
    }
  });

  it("does not leak an unexpected failure", async () => {
    const handlers = handlersFor(identity(), inbox({ listReports: vi.fn(async () => { throw new Error("connection reset by peer at 10.0.0.4"); }) }));
    const response = await handlers.list(request("/api/v1/admin/governance/reports"));
    expect(response.status).toBe(500);
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("10.0.0.4");
  });
});

describe("an affected member's own notices", () => {
  const notices = { listNotices: vi.fn(async () => [{ id: "notice-1", kind: "MEMBER_MUTED" }]), markNoticeRead: vi.fn(async () => ({ id: "notice-1" })) };

  it("needs a session but no operator duty", async () => {
    const handlers = createGovernanceNoticeHandlers({ authenticate: vi.fn(async () => ({ id: "member-1" })) }, notices as never);
    const response = await handlers.list(request("/api/v1/account/notices"));
    expect(response.status).toBe(200);
    expect(notices.listNotices).toHaveBeenCalledWith("member-1");

    const anonymous = createGovernanceNoticeHandlers({ authenticate: vi.fn(async () => null) }, notices as never);
    expect((await anonymous.list(request("/api/v1/account/notices", { session: "" }))).status).toBe(401);
  });

  it("refuses a malformed notice id and a cross-origin clear", async () => {
    const handlers = createGovernanceNoticeHandlers({ authenticate: vi.fn(async () => ({ id: "member-1" })) }, notices as never);
    expect((await handlers.markRead(request("/api/v1/account/notices/nope/read", { method: "POST" }), "nope")).status).toBe(404);
    const crossOrigin = await handlers.markRead(request(`/api/v1/account/notices/${REPORT_ID}/read`, { method: "POST", origin: "https://evil.test" }), REPORT_ID);
    expect(crossOrigin.status).toBeGreaterThanOrEqual(400);
    expect(notices.markNoticeRead).not.toHaveBeenCalled();
  });
});
