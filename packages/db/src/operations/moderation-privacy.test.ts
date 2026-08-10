import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { anonymizeAccountWithin, anonymousDisplayName, normalizeAuditEvent, redactAuditMetadata, roomAllowsMemberRead, roomAllowsPredictions, roomTransition } from "./moderation-privacy.js";

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

/**
 * Story 12.6: an account that is anonymized must lose its photo from object
 * storage too. Deleting only the database reference would leave the member's face
 * readable at its object key forever, which is the failure this asserts against.
 */
describe("account anonymization clears the avatar", () => {
  type Row = Record<string, unknown>;

  function fakeTx(respond: (query: string) => Row[], log: string[]) {
    const run = async (strings: readonly string[], values: readonly unknown[]) => {
      const text = strings.reduce((acc, chunk, index) => acc + chunk + (index < values.length ? " $ " : ""), "").replace(/\s+/g, " ").trim();
      log.push(text);
      return respond(text);
    };
    const tx = (strings: TemplateStringsArray, ...values: unknown[]) => ({
      then: (resolve?: (rows: Row[]) => unknown, reject?: (reason: unknown) => unknown) => run(strings, values).then(resolve, reject),
    });
    return tx as unknown as postgres.Sql;
  }

  const AVATAR_ROW = { objectKey: "avatars/7f3a1c2b-4d5e-4f60-8a91-b2c3d4e5f607/4.webp", fileId: "cloud://env/x" };

  it("deletes the avatar row and books its object in the same transaction", async () => {
    const log: string[] = [];
    const tx = fakeTx((query) => {
      if (query.includes("SELECT is_super_admin")) return [{ superAdmin: false, username: "alice" }];
      if (query.includes("DELETE FROM identity.user_avatars")) return [AVATAR_ROW];
      return [];
    }, log);

    await anonymizeAccountWithin(tx, {
      userId: "12345678-abcd-0000-0000-000000000000",
      actorUserId: "ops-1",
      auditId: "audit-1",
      privacyRequestId: "request-1",
      occurredAt: "2026-08-07T10:00:00.000Z",
    });

    expect(log.some((query) => query.includes("DELETE FROM identity.user_avatars"))).toBe(true);
    expect(log.some((query) => query.includes("INSERT INTO identity.avatar_object_deletions"))).toBe(true);
    // The delete has to land before the audit row closes the transaction out.
    const deleteIndex = log.findIndex((query) => query.includes("DELETE FROM identity.user_avatars"));
    const auditIndex = log.findIndex((query) => query.includes("'ACCOUNT_ANONYMIZED'"));
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeLessThan(auditIndex);
  });

  it("still completes for an account that never had an avatar", async () => {
    const log: string[] = [];
    const tx = fakeTx((query) => (query.includes("SELECT is_super_admin") ? [{ superAdmin: false, username: "alice" }] : []), log);
    await expect(
      anonymizeAccountWithin(tx, {
        userId: "12345678-abcd-0000-0000-000000000000",
        actorUserId: "ops-1",
        auditId: "audit-1",
        privacyRequestId: "request-1",
        occurredAt: "2026-08-07T10:00:00.000Z",
      }),
    ).resolves.toMatchObject({ anonymizedName: "已删除用户-12345678" });
    expect(log.some((query) => query.includes("INSERT INTO identity.avatar_object_deletions"))).toBe(false);
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

    // Rows written with a bare ::jsonb cast hold a jsonb string; an operator must
    // still see fields, not escaped JSON.
    const doubleEncoded = normalizeAuditEvent({
      id: "audit-legacy-1",
      actor: "root_one",
      action: "ROOM_RESTRICT",
      target_type: "ROOM",
      target_id: "room-7",
      result: "SUCCESS",
      metadata: JSON.stringify({ reason: "多次违规举报", status: "RESTRICTED", sessionToken: "raw" }),
      occurred_at: "2026-07-20T09:00:00.000Z",
    });
    expect(doubleEncoded.metadata).toEqual({ reason: "多次违规举报", status: "RESTRICTED", sessionToken: "[REDACTED]" });
    // A metadata value that genuinely is a string stays one.
    expect(normalizeAuditEvent({ ...doubleEncoded, target_type: "ROOM", target_id: "room-7", occurred_at: "2026-07-20T09:00:00.000Z", metadata: "plain note" } as never).metadata).toBe("plain note");

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
