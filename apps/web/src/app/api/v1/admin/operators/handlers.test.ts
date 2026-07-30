import { AuthError } from "@pulse/domain";
import { describe, expect, it, vi } from "vitest";
import { createOperatorRoleHandlers } from "./handlers.js";

const TARGET = "3f1c9d2e-8b47-4a5c-9f6d-2c1a7e5b3d90";
const ORIGIN = "https://example.test";
const path = (userId = TARGET, role = "OPERATIONS_ADMIN") => `${ORIGIN}/api/v1/admin/operators/${userId}/roles/${role}`;

function setup() {
  const identity = {
    listOperatorRoster: vi.fn().mockResolvedValue({ actorId: "admin-1", operators: [] }),
    setOperatorRole: vi.fn().mockResolvedValue({ targetUserId: TARGET, role: "OPERATIONS_ADMIN", granted: true, changed: true, auditId: "audit-1" }),
  };
  return { identity, handlers: createOperatorRoleHandlers(identity) };
}
const write = (method: "PUT" | "DELETE", cookie: string, userId = TARGET, role = "OPERATIONS_ADMIN") =>
  new Request(path(userId, role), { method, headers: { cookie, origin: ORIGIN } });

describe("operator duty API", () => {
  it("grants and revokes with the session plus the re-auth proof cookie", async () => {
    const grant = setup();
    const granted = await grant.handlers.grant(write("PUT", "fp_session=session-token; fp_reauth=proof-token"), TARGET, "OPERATIONS_ADMIN");
    expect(granted.status).toBe(200);
    expect(grant.identity.setOperatorRole).toHaveBeenCalledWith({ actorSessionToken: "session-token", proofToken: "proof-token", targetUserId: TARGET, role: "OPERATIONS_ADMIN", granted: true });

    const revoke = setup();
    const revoked = await revoke.handlers.revoke(write("DELETE", "fp_session=session-token; fp_reauth=proof-token", TARGET, "COMMUNITY_MODERATOR"), TARGET, "COMMUNITY_MODERATOR");
    expect(revoked.status).toBe(200);
    expect(revoke.identity.setOperatorRole).toHaveBeenCalledWith({ actorSessionToken: "session-token", proofToken: "proof-token", targetUserId: TARGET, role: "COMMUNITY_MODERATOR", granted: false });
  });

  it("rejects a role change that carries a session but no re-auth proof", async () => {
    for (const method of ["PUT", "DELETE"] as const) {
      const { handlers, identity } = setup();
      const handler = method === "PUT" ? handlers.grant : handlers.revoke;
      const response = await handler(write(method, "fp_session=session-token"), TARGET, "OPERATIONS_ADMIN");
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("REAUTH_REQUIRED");
      expect(identity.setOperatorRole).not.toHaveBeenCalled();
    }
  });

  it("returns 401 without a session and never touches the service", async () => {
    const { handlers, identity } = setup();
    expect((await handlers.list(new Request(`${ORIGIN}/api/v1/admin/operators`))).status).toBe(401);
    expect(identity.listOperatorRoster).not.toHaveBeenCalled();
    const write401 = await handlers.grant(write("PUT", "fp_reauth=proof-token"), TARGET, "OPERATIONS_ADMIN");
    expect(write401.status).toBe(401);
    expect(identity.setOperatorRole).not.toHaveBeenCalled();
  });

  it("refuses any role outside the grantable set — SUPER_ADMIN above all", async () => {
    for (const role of ["SUPER_ADMIN", "super_admin", "OWNER", "OPERATIONS_ADMIN%20", ""]) {
      const { handlers, identity } = setup();
      const response = await handlers.grant(write("PUT", "fp_session=session-token; fp_reauth=proof-token", TARGET, role || "x"), TARGET, role);
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe("ROLE_NOT_GRANTABLE");
      expect(identity.setOperatorRole).not.toHaveBeenCalled();
    }
  });

  it("refuses a target that is not a well-formed account id", async () => {
    for (const userId of ["not-a-uuid", "../../admin", "1"]) {
      const { handlers, identity } = setup();
      const response = await handlers.grant(write("PUT", "fp_session=session-token; fp_reauth=proof-token", "x"), userId, "OPERATIONS_ADMIN");
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe("TARGET_NOT_MANAGEABLE");
      expect(identity.setOperatorRole).not.toHaveBeenCalled();
    }
  });

  it("rejects a cross-origin role change before authorizing anything", async () => {
    const { handlers, identity } = setup();
    const response = await handlers.grant(new Request(path(), { method: "PUT", headers: { cookie: "fp_session=session-token; fp_reauth=proof-token", origin: "https://evil.test" } }), TARGET, "OPERATIONS_ADMIN");
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(identity.setOperatorRole).not.toHaveBeenCalled();
  });

  it("propagates the server-side decisions: non-super-admin, self-change and ineligible target", async () => {
    const cases: Array<[AuthError, number, string]> = [
      [new AuthError("FORBIDDEN", 403, "You do not have permission for this operation."), 403, "FORBIDDEN"],
      [new AuthError("SELF_ROLE_CHANGE_FORBIDDEN", 403, "Ask the other super administrator to change your own duties."), 403, "SELF_ROLE_CHANGE_FORBIDDEN"],
      [new AuthError("TARGET_NOT_MANAGEABLE", 422, "Only active normal accounts can hold an operator duty."), 422, "TARGET_NOT_MANAGEABLE"],
    ];
    for (const [thrown, status, code] of cases) {
      const { handlers, identity } = setup();
      identity.setOperatorRole.mockRejectedValueOnce(thrown);
      const response = await handlers.grant(write("PUT", "fp_session=session-token; fp_reauth=proof-token"), TARGET, "OPERATIONS_ADMIN");
      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }

    // A restricted operator reading the roster is a plain 403 from the service.
    const { handlers, identity } = setup();
    identity.listOperatorRoster.mockRejectedValueOnce(new AuthError("FORBIDDEN", 403, "You do not have permission for this operation."));
    const response = await handlers.list(new Request(`${ORIGIN}/api/v1/admin/operators`, { headers: { cookie: "fp_session=operations-admin-token" } }));
    expect(response.status).toBe(403);
  });

  it("never caches a duty response", async () => {
    const { handlers } = setup();
    const response = await handlers.list(new Request(`${ORIGIN}/api/v1/admin/operators`, { headers: { cookie: "fp_session=session-token" } }));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
