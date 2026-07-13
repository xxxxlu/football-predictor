import { describe, expect, it, vi } from "vitest";
import { createAdminIdentityHandlers } from "./handlers.js";

describe("admin identity handlers", () => {
  it("requires the session-bound re-auth cookie for normal-account status changes", async () => {
    const identity = {
      listManageableAccounts: vi.fn().mockResolvedValue({ users: [] }),
      setAccountStatus: vi.fn().mockResolvedValue({ targetUserId: "user-1", status: "DISABLED", auditId: "audit-1" }),
    };
    const handlers = createAdminIdentityHandlers(identity);
    const response = await handlers.setStatus(new Request("https://example.test/api/v1/admin/users/user-1/status", { method: "PATCH", headers: { cookie: "fp_session=session-token; fp_reauth=proof-token", "content-type": "application/json" }, body: JSON.stringify({ status: "DISABLED" }) }), "user-1");
    expect(response.status).toBe(200);
    expect(identity.setAccountStatus).toHaveBeenCalledWith({ actorSessionToken: "session-token", proofToken: "proof-token", targetUserId: "user-1", status: "DISABLED" });
  });
});
