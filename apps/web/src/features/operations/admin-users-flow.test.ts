import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_USER_FILTERS,
  activityLabel,
  buildUserQuery,
  completeAnonymization,
  fileAnonymization,
  loadAdminUsers,
  loadAnonymizationQueue,
  loadUserDetail,
  revokeUserSessions,
  updateAdminUserStatus,
  type UserFilters,
} from "./admin-users-flow.js";

const TARGET = "3f1c9d2e-8b47-4a5c-9f6d-2c1a7e5b3d90";
const REASON = "多次违规举报，暂停账户";
const json = (body: unknown, status = 200) => Response.json(body, { status });
const ok = (data: unknown) => Response.json({ data });

describe("admin users console flow", () => {
  it("only sends filters that narrow the roster", () => {
    expect(buildUserQuery(DEFAULT_USER_FILTERS)).toBe("");
    const filters: UserFilters = { search: "  Alice ", status: "DISABLED", activity: "DORMANT_30D", restriction: "COMMUNITY_RESTRICTED", minRooms: 2 };
    expect(Object.fromEntries(new URLSearchParams(buildUserQuery(filters)))).toEqual({ search: "Alice", status: "DISABLED", activity: "DORMANT_30D", restriction: "COMMUNITY_RESTRICTED", minRooms: "2" });
  });

  it("requests the roster with the current filters and revives timestamps", async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({ users: [{ id: TARGET, username: "alice", status: "ACTIVE", lastSeenAt: "2026-07-20T08:00:00.000Z", activityBucket: "ACTIVE_30D", activeSessionCount: 2, roomCount: 3, ownedRoomCount: 1, restrictedRoomCount: 1, openReportCount: 0, communityRestricted: true }] }));
    const users = await loadAdminUsers(fetcher, { ...DEFAULT_USER_FILTERS, status: "ACTIVE" });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/admin/users?status=ACTIVE", { credentials: "same-origin", cache: "no-store" });
    expect(users[0]?.lastSeenAt).toEqual(new Date("2026-07-20T08:00:00.000Z"));
    expect(activityLabel(users[0]!.activityBucket)).toBe("30 天内活跃");
  });

  it("surfaces the server's refusal message instead of a generic failure", async () => {
    // A Response body reads once, so every call needs its own.
    const forbidden = vi.fn(async () => json({ error: { code: "FORBIDDEN", message: "You do not have permission for this operation." } }, 403));
    await expect(loadAdminUsers(forbidden)).rejects.toThrow("You do not have permission for this operation.");
    await expect(loadUserDetail(forbidden, TARGET)).rejects.toThrow("You do not have permission for this operation.");
    await expect(loadAnonymizationQueue(forbidden)).rejects.toThrow("You do not have permission for this operation.");
  });

  it("reads one account's overview with its governance timeline", async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({
      id: TARGET, username: "alice", nickname: null, status: "ACTIVE", lastSeenAt: null, activityBucket: "NEVER",
      activeSessionCount: 0, roomCount: 0, ownedRoomCount: 0, restrictedRoomCount: 0, openReportCount: 0, communityRestricted: false,
      registeredAt: "2026-01-05T00:00:00.000Z", operatorRoles: ["COMMUNITY_MODERATOR"],
      governanceHistory: [{ id: "audit-1", action: "SESSIONS_REVOKED", actor: "root", result: "SUCCESS", metadata: { reason: REASON }, occurredAt: "2026-07-21T09:00:00.000Z" }],
      anonymization: { status: "RECEIVED", dueAt: "2026-07-28T09:00:00.000Z", overdue: false, daysRemaining: 3 },
    }));
    const detail = await loadUserDetail(fetcher, TARGET);
    expect(fetcher).toHaveBeenCalledWith(`/api/v1/admin/users/${TARGET}`, { credentials: "same-origin", cache: "no-store" });
    expect(detail.registeredAt).toEqual(new Date("2026-01-05T00:00:00.000Z"));
    expect(detail.governanceHistory[0]?.occurredAt).toEqual(new Date("2026-07-21T09:00:00.000Z"));
    expect(detail.anonymization?.dueAt).toEqual(new Date("2026-07-28T09:00:00.000Z"));
  });

  it("confirms the operator's own password before each lifecycle write and forwards the reason", async () => {
    const writes: Array<[string, string, (f: typeof fetch) => Promise<unknown>]> = [
      [`/api/v1/admin/users/${TARGET}/status`, "PATCH", (f) => updateAdminUserStatus(f, { userId: TARGET, status: "DISABLED", reason: REASON, password: "correct-horse-battery" })],
      [`/api/v1/admin/users/${TARGET}/sessions`, "DELETE", (f) => revokeUserSessions(f, { userId: TARGET, reason: REASON, password: "correct-horse-battery" })],
      [`/api/v1/admin/users/${TARGET}/anonymization-requests`, "POST", (f) => fileAnonymization(f, { userId: TARGET, reason: REASON, password: "correct-horse-battery" })],
    ];
    for (const [path, method, invoke] of writes) {
      const fetcher = vi.fn().mockResolvedValueOnce(ok({ validUntil: "2026-07-30T00:05:00.000Z" })).mockResolvedValueOnce(ok({ auditId: "audit-1", status: "DISABLED", privacyRequestId: "req-1", revokedSessions: 2 }));
      await invoke(fetcher as unknown as typeof fetch);
      expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/auth/reauthenticate");
      expect(fetcher.mock.calls[1]?.[0]).toBe(path);
      const init = fetcher.mock.calls[1]?.[1] as RequestInit;
      expect(init.method).toBe(method);
      expect(JSON.parse(String(init.body))).toMatchObject({ reason: REASON });
    }
  });

  it("stops before the write when the password confirmation fails", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => json({ error: { message: "密码不正确" } }, 401));
    await expect(updateAdminUserStatus(fetcher, { userId: TARGET, status: "DISABLED", reason: REASON, password: "wrong-password" })).rejects.toThrow("密码不正确");
    await expect(revokeUserSessions(fetcher, { userId: TARGET, reason: REASON, password: "wrong-password" })).rejects.toThrow("密码不正确");
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const call of fetcher.mock.calls) expect(call[0]).toBe("/api/v1/auth/reauthenticate");
  });

  it("refuses to send a justification the server would reject anyway", async () => {
    const fetcher = vi.fn();
    for (const reason of ["", "  ", "abc", "x".repeat(501)]) {
      await expect(updateAdminUserStatus(fetcher, { userId: TARGET, status: "DISABLED", reason, password: "pw-long-enough" })).rejects.toThrow(/理由/);
      await expect(revokeUserSessions(fetcher, { userId: TARGET, reason, password: "pw-long-enough" })).rejects.toThrow(/理由/);
      await expect(fileAnonymization(fetcher, { userId: TARGET, reason, password: "pw-long-enough" })).rejects.toThrow(/理由/);
      await expect(completeAnonymization(fetcher, { userId: TARGET, requestId: "req-1", reason, password: "pw-long-enough" })).rejects.toThrow(/理由/);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("routes completion through the request it is closing", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok({})).mockResolvedValueOnce(ok({ status: "COMPLETED", auditId: "audit-9", privacyRequestId: "req-1" }));
    const result = await completeAnonymization(fetcher as unknown as typeof fetch, { userId: TARGET, requestId: "req-1", reason: REASON, password: "pw-long-enough" });
    expect(fetcher.mock.calls[1]?.[0]).toBe(`/api/v1/admin/users/${TARGET}/anonymization-requests/req-1/complete`);
    expect(result.status).toBe("COMPLETED");
  });
});
