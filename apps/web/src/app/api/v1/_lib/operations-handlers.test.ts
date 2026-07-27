import { describe, expect, it, vi } from "vitest";
import { OperationError } from "@pulse/db";
import { createOperationsHandlers } from "./operations-handlers.js";

const get = (path: string) => new Request(`https://example.test${path}`, { headers: { cookie: "fp_session=token" } });
const patch = (body: unknown) => new Request("https://example.test/api/v1/account/profile", { method: "PATCH", headers: { cookie: "fp_session=token", "content-type": "application/json" }, body: JSON.stringify(body) });
function setup() {
  const identity = { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) };
  const operations = { getProfile: vi.fn().mockResolvedValue({ id: "user-1", username: "alice", nickname: "Alice", roles: ["user"] }), updateNickname: vi.fn().mockResolvedValue({ id: "user-1", username: "alice", nickname: "New", roles: ["user"] }), accountHistory: vi.fn().mockResolvedValue({ records: [] }), submissionStatus: vi.fn(), ticketHistory: vi.fn().mockResolvedValue([]), myTickets: vi.fn().mockResolvedValue([]), ledger: vi.fn().mockResolvedValue({ entries: [] }), leaderboard: vi.fn().mockResolvedValue([]), adminStatus: vi.fn() };
  return { operations, handlers: createOperationsHandlers(identity, operations) };
}
describe("operations API permissions", () => {
  it("updates only a bounded nickname and rejects role injection", async () => {
    const first = setup(); expect((await first.handlers.profilePatch(patch({ nickname: "New" }))).status).toBe(200); expect(first.operations.updateNickname).toHaveBeenCalledWith("user-1", "New");
    const second = setup(); expect((await second.handlers.profilePatch(patch({ nickname: "New", roles: ["super_admin"] }))).status).toBe(422); expect(second.operations.updateNickname).not.toHaveBeenCalled();
  });
  it("does not weaken owner or super-admin denials", async () => {
    const owner = setup(); owner.operations.submissionStatus.mockRejectedValueOnce(new OperationError("FORBIDDEN", 403)); expect((await owner.handlers.submissionStatus(get("/x"), "room-1")).status).toBe(403);
    const admin = setup(); admin.operations.adminStatus.mockRejectedValueOnce(new OperationError("FORBIDDEN", 403)); expect((await admin.handlers.adminStatus(get("/x"))).status).toBe(403);
  });
  it("scopes tickets/mine to the authenticated caller, with or without a fixture filter", async () => {
    const subject = setup();
    const scoped = await subject.handlers.myTickets(get("/api/v1/rooms/room-1/tickets/mine?fixtureId=f1:session-1"), "room-1");
    expect(scoped.status).toBe(200);
    expect(subject.operations.myTickets).toHaveBeenCalledWith("room-1", "user-1", "f1:session-1");
    // No fixtureId = the whole room's unsettled tickets; the caller is still user-1, never a parameter.
    const roomWide = await subject.handlers.myTickets(get("/api/v1/rooms/room-1/tickets/mine"), "room-1");
    expect(roomWide.status).toBe(200);
    expect(subject.operations.myTickets).toHaveBeenLastCalledWith("room-1", "user-1", undefined);
    // An unbounded fixture filter is still refused rather than pushed into SQL.
    const oversized = await subject.handlers.myTickets(get(`/api/v1/rooms/room-1/tickets/mine?fixtureId=${"x".repeat(129)}`), "room-1");
    expect(oversized.status).toBe(422);
    expect(subject.operations.myTickets).toHaveBeenCalledTimes(2);
  });
  it("returns only the authenticated user's cross-competition history", async () => {
    const subject = setup();
    const response = await subject.handlers.accountHistory(get("/api/v1/account/history"));

    expect(response.status).toBe(200);
    expect(subject.operations.accountHistory).toHaveBeenCalledWith("user-1");
  });
  it("serves the sport-neutral submission wall: F1 events carry only the submitted flag", async () => {
    const subject = setup();
    subject.operations.submissionStatus.mockResolvedValueOnce({
      roomId: "room-1", roomName: "QA 房间", viewerRole: "room_owner",
      fixtures: [
        { matchId: "api-football:1", sport: "FOOTBALL", homeTeam: "法国", awayTeam: "西班牙", kickoffAt: "2026-07-24T18:00:00.000Z", status: "OPEN", members: [{ userId: "user-1", displayName: "甲", submitted: false }] },
        { matchId: "f1:session-1", sport: "FORMULA_1", homeTeam: "HUNGARIAN GRAND PRIX", awayTeam: "QUALIFYING", kickoffAt: "2026-07-31T14:00:00.000Z", status: "OPEN", members: [{ userId: "user-1", displayName: "甲", submitted: true }] },
      ],
    });

    const response = await subject.handlers.submissionStatus(get("/x"), "room-1");
    expect(response.status).toBe(200);
    expect(subject.operations.submissionStatus).toHaveBeenCalledWith("room-1", "user-1");
    const body = await response.json() as { data: { fixtures: Array<{ matchId: string; members: Array<Record<string, unknown>> }> } };
    const f1Event = body.data.fixtures.find((fixture) => fixture.matchId.startsWith("f1:"));
    expect(f1Event).toBeDefined();
    expect(f1Event?.members).toEqual([{ userId: "user-1", displayName: "甲", submitted: true }]);
    expect(JSON.stringify(body)).not.toMatch(/selection|stake|odds/i);
  });
});
