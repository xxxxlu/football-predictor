import { describe, expect, it, vi } from "vitest";
import { OperationError } from "@football-predictor/db";
import { createOperationsHandlers } from "./operations-handlers.js";

const get = (path: string) => new Request(`https://example.test${path}`, { headers: { cookie: "fp_session=token" } });
const patch = (body: unknown) => new Request("https://example.test/api/v1/account/profile", { method: "PATCH", headers: { cookie: "fp_session=token", "content-type": "application/json" }, body: JSON.stringify(body) });
function setup() {
  const identity = { authenticate: vi.fn().mockResolvedValue({ id: "user-1" }) };
  const operations = { getProfile: vi.fn().mockResolvedValue({ id: "user-1", username: "alice", nickname: "Alice", roles: ["user"] }), updateNickname: vi.fn().mockResolvedValue({ id: "user-1", username: "alice", nickname: "New", roles: ["user"] }), submissionStatus: vi.fn(), ticketHistory: vi.fn().mockResolvedValue([]), ledger: vi.fn().mockResolvedValue({ entries: [] }), leaderboard: vi.fn().mockResolvedValue([]), adminStatus: vi.fn() };
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
});
