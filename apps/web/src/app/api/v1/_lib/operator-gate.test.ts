import { AuthError, type Capability } from "@pulse/domain";
import { describe, expect, it, vi } from "vitest";
import { requireAnyCapability } from "./operator-gate.js";

const CANDIDATES = ["OPERATIONS_HEALTH_READ", "ROOM_REPORT_READ", "USER_SECURITY_READ", "AUDIT_READ"] as const satisfies readonly Capability[];

const operator = (...capabilities: Capability[]) => ({
  resolveOperator: vi.fn(async () => ({ account: { id: "operator-1" }, capabilities })),
});

describe("requireAnyCapability", () => {
  it("admits a caller holding any candidate, wherever it sits in the list", async () => {
    for (const capability of CANDIDATES) {
      const identity = operator(capability);
      await expect(requireAnyCapability(identity, "session", CANDIDATES)).resolves.toEqual({ actorId: "operator-1", capability });
      // The point of the rewrite: one storage read regardless of position.
      expect(identity.resolveOperator).toHaveBeenCalledTimes(1);
    }
  });

  it("returns the first candidate held, matching the order the old loop settled on", async () => {
    // A re-auth-gated write names this capability, so drifting from list order
    // would quietly change which duty a write is attributed to.
    const identity = operator("AUDIT_READ", "ROOM_REPORT_READ");
    await expect(requireAnyCapability(identity, "session", CANDIDATES)).resolves.toMatchObject({ capability: "ROOM_REPORT_READ" });
  });

  it("refuses a caller holding none of them", async () => {
    const identity = operator("OPERATIONS_TASK_RETRY");
    const refusal = await requireAnyCapability(identity, "session", CANDIDATES).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(AuthError);
    expect(refusal).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("refuses a caller with no capabilities at all", async () => {
    const refusal = await requireAnyCapability(operator(), "session", CANDIDATES).catch((error: unknown) => error);
    expect(refusal).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("lets a non-permission failure through as itself", async () => {
    // An expired session must stay 401. The loop this replaced only advanced on
    // a plain FORBIDDEN for exactly this reason.
    for (const error of [new AuthError("SESSION_EXPIRED", 401, "Log in again."), new AuthError("PASSWORD_CHANGE_REQUIRED", 403, "Change it.")]) {
      const identity = { resolveOperator: vi.fn(async () => { throw error; }) };
      await expect(requireAnyCapability(identity, "session", CANDIDATES)).rejects.toBe(error);
    }
  });

  it("refuses when the candidate list is empty rather than admitting everyone", async () => {
    const refusal = await requireAnyCapability(operator("AUDIT_READ"), "session", []).catch((error: unknown) => error);
    expect(refusal).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});
