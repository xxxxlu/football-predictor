import { describe, expect, it, vi } from "vitest";
import { OperationError } from "@football-predictor/db";
import { createModerationHandlers } from "./moderation-handlers.js";

const request = (path: string, method = "GET", body?: unknown) => new Request(`https://example.test${path}`, {
  method,
  headers: { cookie: "fp_session=token; fp_reauth=proof-token", origin: "https://example.test", ...(body ? { "content-type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

function setup() {
  const identity = { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }), authorizeSuperAdminAction: vi.fn().mockResolvedValue({ id: "admin-1" }) };
  const moderation = {
    reportRoom: vi.fn().mockResolvedValue({ reportId: "report-1", status: "OPEN" }),
    listReports: vi.fn().mockResolvedValue([]),
    listAudit: vi.fn().mockResolvedValue([]),
    listRooms: vi.fn().mockResolvedValue([{ roomId: "room-1", name: "决赛之夜", preMatchStakeVisible: false }]),
    updatePreMatchStakeVisibility: vi.fn().mockResolvedValue({ roomId: "room-1", preMatchStakeVisible: true }),
    moderateRoom: vi.fn().mockResolvedValue({ roomId: "room-1", status: "RESTRICTED" }),
    deleteAccount: vi.fn().mockResolvedValue({ deleted: true }),
  };
  return { identity, moderation, handlers: createModerationHandlers(identity, moderation, { secureCookie: false }) };
}

describe("moderation and privacy API", () => {
  it("lets an authenticated room member submit a bounded report", async () => {
    const { handlers, moderation } = setup();
    const response = await handlers.reportRoom(request("/api/v1/rooms/room-1/reports", "POST", { reason: "房间名称含有骚扰内容" }), "room-1");
    expect(response.status).toBe(201);
    expect(moderation.reportRoom).toHaveBeenCalledWith("room-1", "user-1", "房间名称含有骚扰内容");
  });

  it("rejects malformed moderation actions and preserves repository authorization failures", async () => {
    const invalid = setup();
    expect((await invalid.handlers.moderateRoom(request("/api/v1/admin/rooms/room-1", "PATCH", { action: "DELETE", reason: "bad" }), "room-1")).status).toBe(422);
    const forbidden = setup();
    forbidden.moderation.listReports.mockRejectedValueOnce(new OperationError("FORBIDDEN", 403));
    expect((await forbidden.handlers.listReports(request("/api/v1/admin/reports"))).status).toBe(403);
  });

  it("requires a session-bound re-auth proof before changing room status", async () => {
    const valid = setup();
    const response = await valid.handlers.moderateRoom(request("/api/v1/admin/rooms/room-1", "PATCH", { action: "RESTRICT", reason: "收到有效举报" }), "room-1");
    expect(response.status).toBe(200);
    expect(valid.identity.authorizeSuperAdminAction).toHaveBeenCalledWith({ sessionToken: "token", proofToken: "proof-token" });
    expect(valid.moderation.moderateRoom).toHaveBeenCalledWith("admin-1", "room-1", "RESTRICT", "收到有效举报");

    const missing = setup();
    const withoutProof = new Request("https://example.test/api/v1/admin/rooms/room-1", { method: "PATCH", headers: { cookie: "fp_session=token", origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ action: "CLOSE", reason: "多次违规举报" }) });
    expect((await missing.handlers.moderateRoom(withoutProof, "room-1")).status).toBe(403);
    expect(missing.moderation.moderateRoom).not.toHaveBeenCalled();
  });

  it("anonymizes the account only after explicit confirmation and clears the session cookie", async () => {
    const invalid = setup();
    expect((await invalid.handlers.deleteAccount(request("/api/v1/account", "DELETE", { confirmation: "no" }))).status).toBe(422);
    const valid = setup();
    const response = await valid.handlers.deleteAccount(request("/api/v1/account", "DELETE", { confirmation: "DELETE" }));
    expect(response.status).toBe(200);
    expect(valid.moderation.deleteAccount).toHaveBeenCalledWith("user-1");
    expect(response.headers.get("set-cookie")).toContain("fp_session=;");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("lists all rooms and requires re-auth before changing pre-match stake visibility", async () => {
    const valid = setup();
    expect((await valid.handlers.listRooms(request("/api/v1/admin/rooms"))).status).toBe(200);
    expect(valid.moderation.listRooms).toHaveBeenCalledWith("user-1");
    const response = await valid.handlers.updatePreMatchVisibility(request("/api/v1/admin/rooms/room-1/visibility", "PATCH", { preMatchStakeVisible: true }), "room-1");
    expect(response.status).toBe(200);
    expect(valid.moderation.updatePreMatchStakeVisibility).toHaveBeenCalledWith("admin-1", "room-1", true);

    const missing = setup();
    const withoutProof = new Request("https://example.test/api/v1/admin/rooms/room-1/visibility", { method: "PATCH", headers: { cookie: "fp_session=token", origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ preMatchStakeVisible: true }) });
    expect((await missing.handlers.updatePreMatchVisibility(withoutProof, "room-1")).status).toBe(403);
  });
});
