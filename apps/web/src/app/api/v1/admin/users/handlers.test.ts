import { AuthError } from "@pulse/domain";
import { describe, expect, it, vi } from "vitest";
import { createAdminIdentityHandlers } from "./handlers.js";

describe("admin identity handlers", () => {
  it("requires the session-bound re-auth cookie for normal-account status changes", async () => {
    const identity = {
      listManageableAccounts: vi.fn().mockResolvedValue({ users: [] }),
      getAudienceStats: vi.fn(),
      setAccountStatus: vi.fn().mockResolvedValue({ targetUserId: "user-1", status: "DISABLED", auditId: "audit-1" }),
    };
    const handlers = createAdminIdentityHandlers(identity);
    const response = await handlers.setStatus(new Request("https://example.test/api/v1/admin/users/user-1/status", { method: "PATCH", headers: { cookie: "fp_session=session-token; fp_reauth=proof-token", "content-type": "application/json" }, body: JSON.stringify({ status: "DISABLED" }) }), "user-1");
    expect(response.status).toBe(200);
    expect(identity.setAccountStatus).toHaveBeenCalledWith({ actorSessionToken: "session-token", proofToken: "proof-token", targetUserId: "user-1", status: "DISABLED" });
  });

  it("returns 401 when no session cookie is present and never touches the service", async () => {
    const identity = { listManageableAccounts: vi.fn(), getAudienceStats: vi.fn(), setAccountStatus: vi.fn() };
    const handlers = createAdminIdentityHandlers(identity);
    const response = await handlers.list(new Request("https://example.test/api/v1/admin/users"));
    expect(response.status).toBe(401);
    expect(identity.listManageableAccounts).not.toHaveBeenCalled();
  });

  it("propagates the server-side FORBIDDEN decision for a non-super-admin as 403", async () => {
    const identity = {
      listManageableAccounts: vi.fn().mockRejectedValue(new AuthError("FORBIDDEN", 403, "This operation is limited to super administrators.")),
      getAudienceStats: vi.fn(),
      setAccountStatus: vi.fn(),
    };
    const handlers = createAdminIdentityHandlers(identity);
    const response = await handlers.list(new Request("https://example.test/api/v1/admin/users", { headers: { cookie: "fp_session=normal-user-token" } }));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("rejects a status write that carries a session but no re-auth proof", async () => {
    const identity = { listManageableAccounts: vi.fn(), getAudienceStats: vi.fn(), setAccountStatus: vi.fn() };
    const handlers = createAdminIdentityHandlers(identity);
    const response = await handlers.setStatus(new Request("https://example.test/api/v1/admin/users/user-1/status", { method: "PATCH", headers: { cookie: "fp_session=session-token", origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ status: "DISABLED" }) }), "user-1");
    expect(response.status).toBe(403);
    expect(identity.setAccountStatus).not.toHaveBeenCalled();
  });
});
