import { describe, expect, it, vi } from "vitest";
import { F1ResultEntryError } from "@football-predictor/domain";
import { createF1AdminHandlers } from "./f1-admin-handlers.js";

const classification = [
  { driverCode: "NOR", position: 1, status: "FINISHED", lapsCompleted: 70 },
  { driverCode: "VER", position: 2, status: "FINISHED", lapsCompleted: 70 },
];

const request = (path: string, body: unknown, headers: Record<string, string> = {}) => new Request(`https://example.test${path}`, {
  method: "POST",
  headers: {
    cookie: "fp_session=token; fp_reauth=proof-token",
    origin: "https://example.test",
    "content-type": "application/json",
    ...headers,
  },
  body: JSON.stringify(body),
});

function setup() {
  const identity = { authorizeSuperAdminAction: vi.fn().mockResolvedValue({ id: "admin-1" }) };
  const results = {
    enterResult: vi.fn().mockResolvedValue({ sessionId: "session-1", version: 1, alreadyApplied: false }),
    confirmResult: vi.fn().mockResolvedValue({ sessionId: "session-1", version: 1, alreadyApplied: false }),
    cancelSession: vi.fn().mockResolvedValue({ sessionId: "session-1", version: 2, alreadyApplied: false }),
  };
  return { identity, results, handlers: createF1AdminHandlers(identity, results) };
}

describe("F1 admin result API", () => {
  it("enters a classification as the authorized super-admin", async () => {
    const { handlers, identity, results } = setup();
    const response = await handlers.enterResult(request("/api/v1/admin/f1/sessions/session-1/results", { classification }), "session-1");
    expect(response.status).toBe(201);
    expect(identity.authorizeSuperAdminAction).toHaveBeenCalledWith({ sessionToken: "token", proofToken: "proof-token" });
    expect(results.enterResult).toHaveBeenCalledWith({ sessionId: "session-1", classification, enteredBy: "admin-1" });
  });

  it("requires the session-bound re-auth proof on every operation", async () => {
    const { handlers, results } = setup();
    const withoutProof = new Request("https://example.test/api/v1/admin/f1/sessions/session-1/results", {
      method: "POST",
      headers: { cookie: "fp_session=token", origin: "https://example.test", "content-type": "application/json" },
      body: JSON.stringify({ classification }),
    });
    expect((await handlers.enterResult(withoutProof, "session-1")).status).toBe(403);
    expect(results.enterResult).not.toHaveBeenCalled();
  });

  it("confirms and cancels with bounded payloads", async () => {
    const { handlers, results } = setup();
    expect((await handlers.confirmResult(request("/x", { version: 1 }), "session-1")).status).toBe(200);
    expect(results.confirmResult).toHaveBeenCalledWith({ sessionId: "session-1", version: 1, confirmedBy: "admin-1" });
    expect((await handlers.cancelSession(request("/x", { reason: "red flag void" }), "session-1")).status).toBe(200);
    expect(results.cancelSession).toHaveBeenCalledWith({ sessionId: "session-1", cancelledBy: "admin-1", reason: "red flag void" });
  });

  it("rejects malformed classifications and maps domain errors to statuses", async () => {
    const { handlers, results } = setup();
    expect((await handlers.enterResult(request("/x", { classification: [] }), "session-1")).status).toBe(422);
    expect((await handlers.enterResult(request("/x", { classification: [{ driverCode: "nor", position: 1, status: "FINISHED", lapsCompleted: 1 }] }), "session-1")).status).toBe(422);
    expect((await handlers.confirmResult(request("/x", { version: 0 }), "session-1")).status).toBe(422);

    results.confirmResult.mockRejectedValueOnce(new F1ResultEntryError("VERSION_CONFLICT"));
    expect((await handlers.confirmResult(request("/x", { version: 3 }), "session-1")).status).toBe(409);
    results.enterResult.mockRejectedValueOnce(new F1ResultEntryError("SESSION_NOT_FOUND"));
    expect((await handlers.enterResult(request("/x", { classification }), "missing")).status).toBe(404);
    results.enterResult.mockRejectedValueOnce(new F1ResultEntryError("UNKNOWN_DRIVER", "ZZZ"));
    expect((await handlers.enterResult(request("/x", { classification }), "session-1")).status).toBe(422);
  });
});
