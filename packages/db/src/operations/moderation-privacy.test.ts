import { describe, expect, it } from "vitest";
import { anonymousDisplayName, normalizeAuditEvent, redactAuditMetadata, roomAllowsMemberRead, roomAllowsPredictions, roomTransition } from "./moderation-privacy.js";

describe("moderation and privacy rules", () => {
  it("blocks predictions as soon as a room is restricted or closed", () => {
    expect(roomAllowsPredictions("ACTIVE")).toBe(true);
    expect(roomAllowsPredictions("RESTRICTED")).toBe(false);
    expect(roomAllowsPredictions("CLOSED")).toBe(false);
  });

  it("keeps restricted and closed rooms readable to existing members for traceability", () => {
    expect(roomAllowsMemberRead("ACTIVE")).toBe(true);
    expect(roomAllowsMemberRead("RESTRICTED")).toBe(true);
    expect(roomAllowsMemberRead("CLOSED")).toBe(true);
  });

  it("maps admin actions to explicit room states and creates a non-identifying label", () => {
    expect(roomTransition("RESTRICT")).toBe("RESTRICTED");
    expect(roomTransition("CLOSE")).toBe("CLOSED");
    expect(roomTransition("RESTORE")).toBe("ACTIVE");
    expect(anonymousDisplayName("12345678-abcd-0000-0000-000000000000")).toBe("已删除用户-12345678");
  });
});

describe("governance audit redaction", () => {
  it("removes any secret-like metadata keys at every depth while keeping governance evidence", () => {
    const safe = redactAuditMetadata({
      reason: "多次违规举报",
      status: "RESTRICTED",
      reportId: "report-1",
      inviteToken: "raw-invite-token",
      recoveryCode: "FP-ABCD-EFGH",
      sessionToken: "raw-session",
      passwordHash: "argon2id$secret",
      nested: { proofToken: "raw-proof", note: "keep" },
      trail: [{ apiKey: "leak" }, { keep: "ok" }],
    });
    expect(safe).toEqual({
      reason: "多次违规举报",
      status: "RESTRICTED",
      reportId: "report-1",
      inviteToken: "[REDACTED]",
      recoveryCode: "[REDACTED]",
      sessionToken: "[REDACTED]",
      passwordHash: "[REDACTED]",
      nested: { proofToken: "[REDACTED]", note: "keep" },
      trail: [{ apiKey: "[REDACTED]" }, { keep: "ok" }],
    });
  });

  it("tolerates non-object metadata and preserves null", () => {
    expect(redactAuditMetadata(null)).toBeNull();
    expect(redactAuditMetadata("plain")).toBe("plain");
    expect(redactAuditMetadata(42)).toBe(42);
  });
});

describe("unified governance audit normalization", () => {
  it("normalizes account-status, room and operations audit rows into one redacted shape", () => {
    const accountEvent = normalizeAuditEvent({
      id: "audit-account-1",
      actor: "ops_admin",
      action: "ACCOUNT_DISABLED",
      target_type: "USER",
      target_id: "user-9",
      result: "SUCCESS",
      metadata: {},
      occurred_at: "2026-07-15T09:00:00.000Z",
    });
    expect(accountEvent).toEqual({
      id: "audit-account-1",
      actor: "ops_admin",
      action: "ACCOUNT_DISABLED",
      targetType: "USER",
      targetId: "user-9",
      result: "SUCCESS",
      metadata: {},
      occurredAt: "2026-07-15T09:00:00.000Z",
    });

    const roomEvent = normalizeAuditEvent({
      id: "audit-room-1",
      actor: null,
      action: "INVITE_RESET",
      target_type: "ROOM",
      target_id: "room-3",
      result: "SUCCESS",
      metadata: { inviteToken: "should-not-appear" },
      occurred_at: new Date("2026-07-15T08:00:00.000Z"),
    });
    expect(roomEvent.actor).toBeNull();
    expect(roomEvent.targetType).toBe("ROOM");
    expect(roomEvent.occurredAt).toBe("2026-07-15T08:00:00.000Z");
    expect(roomEvent.metadata).toEqual({ inviteToken: "[REDACTED]" });
  });
});
