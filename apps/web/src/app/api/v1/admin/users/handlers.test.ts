import { AuthError } from "@pulse/domain";
import { OperationError } from "@pulse/db";
import { describe, expect, it, vi } from "vitest";
import { createAdminIdentityHandlers } from "./handlers.js";

const TARGET = "3f1c9d2e-8b47-4a5c-9f6d-2c1a7e5b3d90";
const REQUEST_ID = "8a2b6c14-5d39-4e72-9b81-0f4c6a2e7d55";
const ORIGIN = "https://example.test";
const REASON = "多次违规举报，暂停账户";
const AUTHED = "fp_session=session-token; fp_reauth=proof-token";

function setup() {
  const identity = {
    requireCapability: vi.fn().mockResolvedValue({ id: "operator-1" }),
    authorizeCapabilityAction: vi.fn().mockResolvedValue({ id: "operator-1" }),
    getAudienceStats: vi.fn().mockResolvedValue({ totalUsers: 0 }),
    setAccountStatus: vi.fn().mockResolvedValue({ targetUserId: TARGET, status: "DISABLED", auditId: "audit-1" }),
  };
  const console_ = {
    listUsers: vi.fn().mockResolvedValue([]),
    getUser: vi.fn().mockResolvedValue({ id: TARGET, username: "alice" }),
    revokeSessions: vi.fn().mockResolvedValue({ targetUserId: TARGET, revokedSessions: 2, auditId: "audit-2" }),
    removeAvatar: vi.fn().mockResolvedValue({ targetUserId: TARGET, removed: true, auditId: "audit-5" }),
    fileAnonymizationRequest: vi.fn().mockResolvedValue({ privacyRequestId: REQUEST_ID, status: "RECEIVED", auditId: "audit-3" }),
    completeAnonymizationRequest: vi.fn().mockResolvedValue({ privacyRequestId: REQUEST_ID, status: "COMPLETED", auditId: "audit-4" }),
    listAnonymizationRequests: vi.fn().mockResolvedValue([]),
  };
  return { identity, console_, handlers: createAdminIdentityHandlers(identity, console_) };
}
const read = (path: string, cookie = "fp_session=session-token") => new Request(`${ORIGIN}${path}`, { headers: { cookie } });
const write = (path: string, method: string, body: unknown, cookie = AUTHED, origin = ORIGIN) =>
  new Request(`${ORIGIN}${path}`, { method, headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body) });

describe("user security console API", () => {
  it("passes validated filters through and reports the query it actually ran", async () => {
    const { handlers, console_, identity } = setup();
    const response = await handlers.list(read("/api/v1/admin/users?search=ALICE&status=DISABLED&activity=DORMANT_30D&restriction=COMMUNITY_RESTRICTED&minRooms=2&limit=25"));
    expect(response.status).toBe(200);
    expect(identity.requireCapability).toHaveBeenCalledWith("session-token", "USER_SECURITY_READ");
    expect(console_.listUsers).toHaveBeenCalledWith("operator-1", { search: "alice", status: "DISABLED", activity: "DORMANT_30D", restriction: "COMMUNITY_RESTRICTED", minRooms: 2, limit: 25 });
    await expect(response.json()).resolves.toMatchObject({ data: { actorId: "operator-1", query: { status: "DISABLED" } } });
  });

  it("refuses an unknown filter value before authorizing or reading anything", async () => {
    for (const query of ["status=SUPER_ADMIN", "activity=FOREVER", "restriction=MUTED", "minRooms=-1", "limit=9999"]) {
      const { handlers, console_, identity } = setup();
      const response = await handlers.list(read(`/api/v1/admin/users?${query}`));
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe("INVALID_REQUEST");
      expect(identity.requireCapability).not.toHaveBeenCalled();
      expect(console_.listUsers).not.toHaveBeenCalled();
    }
  });

  it("returns 401 without a session and never touches the console", async () => {
    const { handlers, console_ } = setup();
    expect((await handlers.list(new Request(`${ORIGIN}/api/v1/admin/users`))).status).toBe(401);
    expect((await handlers.detail(new Request(`${ORIGIN}/api/v1/admin/users/${TARGET}`), TARGET)).status).toBe(401);
    expect(console_.listUsers).not.toHaveBeenCalled();
    expect(console_.getUser).not.toHaveBeenCalled();
  });

  it("propagates a restricted operator's FORBIDDEN as 403 on every read", async () => {
    for (const call of ["list", "detail", "listAnonymizationRequests"] as const) {
      const { handlers, identity, console_ } = setup();
      identity.requireCapability.mockRejectedValueOnce(new AuthError("FORBIDDEN", 403, "You do not have permission for this operation."));
      const response = call === "detail"
        ? await handlers.detail(read(`/api/v1/admin/users/${TARGET}`), TARGET)
        : await handlers[call](read("/api/v1/admin/users"));
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("FORBIDDEN");
      expect(console_.listUsers).not.toHaveBeenCalled();
      expect(console_.getUser).not.toHaveBeenCalled();
    }
  });

  it("requires the re-auth proof for every lifecycle write", async () => {
    const cases: Array<[string, unknown, (h: ReturnType<typeof setup>["handlers"], r: Request) => Promise<Response>]> = [
      ["status", { status: "DISABLED", reason: REASON }, (h, r) => h.setStatus(r, TARGET)],
      ["sessions", { reason: REASON }, (h, r) => h.revokeSessions(r, TARGET)],
      ["anonymization-requests", { reason: REASON }, (h, r) => h.fileAnonymizationRequest(r, TARGET)],
      ["anonymization-requests/x/complete", { reason: REASON }, (h, r) => h.completeAnonymizationRequest(r, TARGET, REQUEST_ID)],
    ];
    for (const [name, body, invoke] of cases) {
      const { handlers, identity, console_ } = setup();
      const response = await invoke(handlers, write(`/api/v1/admin/users/${TARGET}/${name}`, "POST", body, "fp_session=session-token"));
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("REAUTH_REQUIRED");
      expect(identity.setAccountStatus).not.toHaveBeenCalled();
      expect(identity.authorizeCapabilityAction).not.toHaveBeenCalled();
      expect(console_.revokeSessions).not.toHaveBeenCalled();
      expect(console_.fileAnonymizationRequest).not.toHaveBeenCalled();
      expect(console_.completeAnonymizationRequest).not.toHaveBeenCalled();
    }
  });

  it("requires a usable justification for every lifecycle write", async () => {
    for (const reason of [undefined, "", "abc", "x".repeat(501)]) {
      const body = reason === undefined ? {} : { reason };
      const status = setup();
      expect((await status.handlers.setStatus(write(`/api/v1/admin/users/${TARGET}/status`, "PATCH", { status: "DISABLED", ...body }), TARGET)).status).toBe(422);
      expect(status.identity.setAccountStatus).not.toHaveBeenCalled();

      const sessions = setup();
      expect((await sessions.handlers.revokeSessions(write(`/api/v1/admin/users/${TARGET}/sessions`, "DELETE", body), TARGET)).status).toBe(422);
      expect(sessions.console_.revokeSessions).not.toHaveBeenCalled();

      const filed = setup();
      expect((await filed.handlers.fileAnonymizationRequest(write(`/api/v1/admin/users/${TARGET}/anonymization-requests`, "POST", body), TARGET)).status).toBe(422);
      expect(filed.console_.fileAnonymizationRequest).not.toHaveBeenCalled();
    }
  });

  it("rejects an unknown field in a lifecycle body rather than ignoring it", async () => {
    const { handlers, identity } = setup();
    const response = await handlers.setStatus(write(`/api/v1/admin/users/${TARGET}/status`, "PATCH", { status: "DISABLED", reason: REASON, isSuperAdmin: true }), TARGET);
    expect(response.status).toBe(422);
    expect(identity.setAccountStatus).not.toHaveBeenCalled();
  });

  it("carries the trimmed reason into the disable, revoke and anonymization calls", async () => {
    const status = setup();
    expect((await status.handlers.setStatus(write(`/api/v1/admin/users/${TARGET}/status`, "PATCH", { status: "DISABLED", reason: `  ${REASON}  ` }), TARGET)).status).toBe(200);
    expect(status.identity.setAccountStatus).toHaveBeenCalledWith({ actorSessionToken: "session-token", proofToken: "proof-token", targetUserId: TARGET, status: "DISABLED", reason: REASON });

    const sessions = setup();
    expect((await sessions.handlers.revokeSessions(write(`/api/v1/admin/users/${TARGET}/sessions`, "DELETE", { reason: REASON }), TARGET)).status).toBe(200);
    expect(sessions.identity.authorizeCapabilityAction).toHaveBeenCalledWith({ sessionToken: "session-token", proofToken: "proof-token", capability: "USER_SECURITY_WRITE" });
    expect(sessions.console_.revokeSessions).toHaveBeenCalledWith("operator-1", TARGET, REASON);

    const filed = setup();
    const created = await filed.handlers.fileAnonymizationRequest(write(`/api/v1/admin/users/${TARGET}/anonymization-requests`, "POST", { reason: REASON }), TARGET);
    expect(created.status).toBe(201);
    expect(filed.console_.fileAnonymizationRequest).toHaveBeenCalledWith("operator-1", TARGET, REASON);

    const completed = setup();
    expect((await completed.handlers.completeAnonymizationRequest(write(`/api/v1/admin/users/${TARGET}/anonymization-requests/${REQUEST_ID}/complete`, "POST", { reason: REASON }), TARGET, REQUEST_ID)).status).toBe(200);
    expect(completed.console_.completeAnonymizationRequest).toHaveBeenCalledWith("operator-1", TARGET, REQUEST_ID, REASON);
  });

  it("refuses a target or request id that is not a well-formed account id", async () => {
    for (const userId of ["not-a-uuid", "../../admin", "1"]) {
      const { handlers, console_ } = setup();
      expect((await handlers.detail(read(`/api/v1/admin/users/${userId}`), userId)).status).toBe(422);
      expect((await handlers.revokeSessions(write(`/api/v1/admin/users/${userId}/sessions`, "DELETE", { reason: REASON }), userId)).status).toBe(422);
      expect(console_.getUser).not.toHaveBeenCalled();
      expect(console_.revokeSessions).not.toHaveBeenCalled();
    }
    const { handlers, console_ } = setup();
    const response = await handlers.completeAnonymizationRequest(write(`/api/v1/admin/users/${TARGET}/anonymization-requests/nope/complete`, "POST", { reason: REASON }), TARGET, "nope");
    expect(response.status).toBe(409);
    expect(console_.completeAnonymizationRequest).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin lifecycle write before authorizing", async () => {
    const { handlers, identity, console_ } = setup();
    const response = await handlers.revokeSessions(write(`/api/v1/admin/users/${TARGET}/sessions`, "DELETE", { reason: REASON }, AUTHED, "https://evil.test"), TARGET);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(identity.authorizeCapabilityAction).not.toHaveBeenCalled();
    expect(console_.revokeSessions).not.toHaveBeenCalled();
  });

  it("maps repository lifecycle refusals onto the shared error contract", async () => {
    const cases: Array<[OperationError, number, string]> = [
      [new OperationError("ANONYMIZATION_REQUEST_EXISTS", 409), 409, "ANONYMIZATION_REQUEST_EXISTS"],
      [new OperationError("TARGET_NOT_MANAGEABLE", 422), 422, "TARGET_NOT_MANAGEABLE"],
      [new OperationError("FORBIDDEN", 403), 403, "FORBIDDEN"],
    ];
    for (const [thrown, status, code] of cases) {
      const { handlers, console_ } = setup();
      console_.fileAnonymizationRequest.mockRejectedValueOnce(thrown);
      const response = await handlers.fileAnonymizationRequest(write(`/api/v1/admin/users/${TARGET}/anonymization-requests`, "POST", { reason: REASON }), TARGET);
      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
  });

  it("keeps audience analytics on its own super-admin-only capability", async () => {
    const { handlers, identity } = setup();
    expect((await handlers.audience(read("/api/v1/admin/audience"))).status).toBe(200);
    expect(identity.getAudienceStats).toHaveBeenCalledWith("session-token");
    // The service owns that gate, so a refusal there must surface unchanged.
    const denied = setup();
    denied.identity.getAudienceStats.mockRejectedValueOnce(new AuthError("FORBIDDEN", 403, "You do not have permission for this operation."));
    expect((await denied.handlers.audience(read("/api/v1/admin/audience"))).status).toBe(403);
  });

  /* Story 12.6: an avatar takedown is a lifecycle write like any other — same
     capability, same fresh re-auth proof, same mandatory justification, same
     audit row. It is listed separately because it is the newest one and the
     easiest to wire up with a weaker gate by accident. */
  it("gates the admin avatar takedown on USER_SECURITY_WRITE plus a fresh re-auth proof", async () => {
    const missingProof = setup();
    const denied = await missingProof.handlers.removeAvatar(
      write(`/api/v1/admin/users/${TARGET}/avatar`, "DELETE", { reason: REASON }, "fp_session=session-token"),
      TARGET,
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe("REAUTH_REQUIRED");
    expect(missingProof.identity.authorizeCapabilityAction).not.toHaveBeenCalled();
    expect(missingProof.console_.removeAvatar).not.toHaveBeenCalled();

    const forbidden = setup();
    forbidden.identity.authorizeCapabilityAction.mockRejectedValueOnce(new AuthError("FORBIDDEN", 403, "You do not have permission for this operation."));
    const refused = await forbidden.handlers.removeAvatar(write(`/api/v1/admin/users/${TARGET}/avatar`, "DELETE", { reason: REASON }), TARGET);
    expect(refused.status).toBe(403);
    expect(forbidden.console_.removeAvatar).not.toHaveBeenCalled();

    const allowed = setup();
    const response = await allowed.handlers.removeAvatar(write(`/api/v1/admin/users/${TARGET}/avatar`, "DELETE", { reason: `  ${REASON}  ` }), TARGET);
    expect(response.status).toBe(200);
    expect(allowed.identity.authorizeCapabilityAction).toHaveBeenCalledWith({ sessionToken: "session-token", proofToken: "proof-token", capability: "USER_SECURITY_WRITE" });
    expect(allowed.console_.removeAvatar).toHaveBeenCalledWith("operator-1", TARGET, REASON);
    await expect(response.json()).resolves.toMatchObject({ data: { removed: true, auditId: "audit-5" } });
  });

  it("refuses an avatar takedown without a justification, cross-origin, or against a malformed id", async () => {
    const noReason = setup();
    expect((await noReason.handlers.removeAvatar(write(`/api/v1/admin/users/${TARGET}/avatar`, "DELETE", {}), TARGET)).status).toBe(422);
    expect(noReason.console_.removeAvatar).not.toHaveBeenCalled();

    const crossOrigin = setup();
    const response = await crossOrigin.handlers.removeAvatar(
      write(`/api/v1/admin/users/${TARGET}/avatar`, "DELETE", { reason: REASON }, AUTHED, "https://evil.test"),
      TARGET,
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(crossOrigin.identity.authorizeCapabilityAction).not.toHaveBeenCalled();
    expect(crossOrigin.console_.removeAvatar).not.toHaveBeenCalled();

    const badTarget = setup();
    expect((await badTarget.handlers.removeAvatar(write(`/api/v1/admin/users/nope/avatar`, "DELETE", { reason: REASON }), "nope")).status).toBe(422);
    expect(badTarget.console_.removeAvatar).not.toHaveBeenCalled();
  });

  it("never caches a console response", async () => {
    const { handlers } = setup();
    for (const response of [await handlers.list(read("/api/v1/admin/users")), await handlers.detail(read(`/api/v1/admin/users/${TARGET}`), TARGET)]) {
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});
