import { describe, expect, it, vi } from "vitest";
import { GRANTABLE_ROLES, ROLE_LABELS, loadOperatorRoster, setOperatorRole } from "./admin-operators-flow";

const TARGET = "3f1c9d2e-8b47-4a5c-9f6d-2c1a7e5b3d90";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("operator duty flow", () => {
  it("never offers SUPER_ADMIN as a grantable duty", () => {
    expect(GRANTABLE_ROLES).toEqual(["OPERATIONS_ADMIN", "COMMUNITY_MODERATOR"]);
    expect(GRANTABLE_ROLES).not.toContain("SUPER_ADMIN");
    expect(ROLE_LABELS.SUPER_ADMIN).toBe("超级管理员");
  });

  it("re-authenticates before it grants, and sends the duty as a path segment", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ data: { verified: true } }))
      .mockResolvedValueOnce(json({ data: { targetUserId: TARGET, role: "OPERATIONS_ADMIN", granted: true, changed: true, auditId: "audit-1" } }));
    const result = await setOperatorRole(fetcher, { userId: TARGET, role: "OPERATIONS_ADMIN", granted: true, password: "rotated-password-456" });

    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/auth/reauthenticate");
    expect(fetcher.mock.calls[1]?.[0]).toBe(`/api/v1/admin/operators/${TARGET}/roles/OPERATIONS_ADMIN`);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: "PUT", credentials: "same-origin" });
    expect(result).toMatchObject({ granted: true, changed: true, auditId: "audit-1" });
  });

  it("revokes with DELETE and never puts the password in the role request", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ data: { verified: true } }))
      .mockResolvedValueOnce(json({ data: { targetUserId: TARGET, role: "COMMUNITY_MODERATOR", granted: false, changed: true, auditId: "audit-2" } }));
    await setOperatorRole(fetcher, { userId: TARGET, role: "COMMUNITY_MODERATOR", granted: false, password: "rotated-password-456" });

    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
    expect(JSON.stringify(fetcher.mock.calls[1])).not.toContain("rotated-password-456");
  });

  it("stops at a failed identity confirmation without touching the role endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ error: { code: "INVALID_CREDENTIALS", message: "管理员身份确认失败" } }, 401));
    await expect(setOperatorRole(fetcher, { userId: TARGET, role: "OPERATIONS_ADMIN", granted: true, password: "wrong-password-123" })).rejects.toThrow("管理员身份确认失败");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server's refusal message for a forbidden or self-change attempt", async () => {
    for (const [status, code, message] of [[403, "FORBIDDEN", "无权执行"], [403, "SELF_ROLE_CHANGE_FORBIDDEN", "不能给自己授予"]] as const) {
      const fetcher = vi.fn()
        .mockResolvedValueOnce(json({ data: { verified: true } }))
        .mockResolvedValueOnce(json({ error: { code, message } }, status));
      await expect(setOperatorRole(fetcher, { userId: TARGET, role: "OPERATIONS_ADMIN", granted: true, password: "rotated-password-456" })).rejects.toThrow(message);
    }
  });

  it("reports a roster read failure instead of rendering an empty roster", async () => {
    const forbidden = vi.fn().mockResolvedValue(json({ error: { code: "FORBIDDEN", message: "无权查看运营职责" } }, 403));
    await expect(loadOperatorRoster(forbidden)).rejects.toThrow("无权查看运营职责");
    const roster = vi.fn().mockResolvedValue(json({ data: { actorId: "admin-1", operators: [] } }));
    await expect(loadOperatorRoster(roster)).resolves.toEqual({ actorId: "admin-1", operators: [] });
  });
});
