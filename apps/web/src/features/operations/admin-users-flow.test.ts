import { describe, expect, it, vi } from "vitest";
import { loadAdminUsers, updateAdminUserStatus } from "./admin-users-flow.js";

describe("admin user management flow", () => {
  it("loads only the manageable user status projection", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { actorId: "admin-1", users: [{ id: "user-1", username: "alice", status: "ACTIVE" }] } }));
    await expect(loadAdminUsers(fetcher)).resolves.toEqual([{ id: "user-1", username: "alice", status: "ACTIVE" }]);
  });

  it("re-authenticates before changing account status", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: { verified: true } }))
      .mockResolvedValueOnce(Response.json({ data: { targetUserId: "user-1", status: "DISABLED", auditId: "audit-1" } }));
    await expect(updateAdminUserStatus(fetcher, { userId: "user-1", status: "DISABLED", password: "admin-password-123" })).resolves.toMatchObject({ status: "DISABLED", auditId: "audit-1" });
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/v1/auth/reauthenticate", expect.objectContaining({ method: "POST" }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/v1/admin/users/user-1/status", expect.objectContaining({ method: "PATCH" }));
  });

  it("does not mutate the account when re-authentication fails", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { message: "密码不正确" } }, { status: 401 }));
    await expect(updateAdminUserStatus(fetcher, { userId: "user-1", status: "DISABLED", password: "wrong-password" })).rejects.toThrow("密码不正确");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
