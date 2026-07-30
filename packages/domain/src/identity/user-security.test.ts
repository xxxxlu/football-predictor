import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_USER_SECURITY_KEYS,
  activityBucket,
  REDACTION_MARKER,
  assertSafeUserSecurityPayload,
  matchesActivityFilter,
  parseUserSecurityQuery,
  summarizeLifecycle,
  type UserSecurityDetail,
} from "./user-security.js";

const now = new Date("2026-07-30T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("user security query parsing", () => {
  it("defaults to an unfiltered, bounded roster read", () => {
    expect(parseUserSecurityQuery({})).toEqual({ search: "", status: "ALL", activity: "ALL", restriction: "ALL", minRooms: 0, limit: 100 });
  });

  it("normalizes the username search the same way login does", () => {
    expect(parseUserSecurityQuery({ search: "  ALICE_01 " }).search).toBe("alice_01");
    // Only characters a username can legally contain survive. `_` is legal and is
    // kept, so the repository must match by literal containment, never LIKE —
    // otherwise `_` would act as a single-character wildcard.
    expect(parseUserSecurityQuery({ search: "a%b\\c'; drop--" }).search).toBe("abcdrop");
    expect(parseUserSecurityQuery({ search: "a_b" }).search).toBe("a_b");
    expect(parseUserSecurityQuery({ search: "a".repeat(200) }).search).toHaveLength(32);
  });

  it("accepts every documented filter value", () => {
    expect(parseUserSecurityQuery({ status: "DISABLED", activity: "DORMANT_30D", restriction: "COMMUNITY_RESTRICTED", minRooms: "3", limit: "25" }))
      .toEqual({ search: "", status: "DISABLED", activity: "DORMANT_30D", restriction: "COMMUNITY_RESTRICTED", minRooms: 3, limit: 25 });
  });

  it("rejects an unknown filter value instead of silently widening the read", () => {
    for (const raw of [{ status: "SUPER_ADMIN" }, { status: "all" }, { activity: "FOREVER" }, { restriction: "MUTED" }]) {
      expect(() => parseUserSecurityQuery(raw)).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST", status: 422 }));
    }
  });

  it("rejects a non-numeric, negative or oversized bound", () => {
    for (const raw of [{ minRooms: "-1" }, { minRooms: "abc" }, { minRooms: "1.5" }, { limit: "0" }, { limit: "1000" }, { limit: "abc" }]) {
      expect(() => parseUserSecurityQuery(raw)).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST", status: 422 }));
    }
  });
});

describe("activity bucketing", () => {
  it("buckets by last observed session activity", () => {
    expect(activityBucket(null, now)).toBe("NEVER");
    expect(activityBucket(ago(HOUR), now)).toBe("ACTIVE_24H");
    expect(activityBucket(ago(3 * DAY), now)).toBe("ACTIVE_7D");
    expect(activityBucket(ago(20 * DAY), now)).toBe("ACTIVE_30D");
    expect(activityBucket(ago(90 * DAY), now)).toBe("DORMANT");
  });

  it("treats the boundaries as inclusive of the shorter window", () => {
    expect(activityBucket(ago(DAY), now)).toBe("ACTIVE_24H");
    expect(activityBucket(ago(DAY + 1), now)).toBe("ACTIVE_7D");
    expect(activityBucket(ago(30 * DAY), now)).toBe("ACTIVE_30D");
    expect(activityBucket(ago(30 * DAY + 1), now)).toBe("DORMANT");
  });

  it("matches a bucket against the requested filter", () => {
    expect(matchesActivityFilter("ACTIVE_24H", "ALL")).toBe(true);
    expect(matchesActivityFilter("ACTIVE_24H", "LAST_24H")).toBe(true);
    expect(matchesActivityFilter("ACTIVE_24H", "LAST_7D")).toBe(true);
    expect(matchesActivityFilter("ACTIVE_7D", "LAST_24H")).toBe(false);
    expect(matchesActivityFilter("DORMANT", "DORMANT_30D")).toBe(true);
    expect(matchesActivityFilter("NEVER", "DORMANT_30D")).toBe(false);
    expect(matchesActivityFilter("NEVER", "NEVER")).toBe(true);
    expect(matchesActivityFilter("DORMANT", "LAST_30D")).toBe(false);
  });
});

describe("lifecycle summary", () => {
  it("reports the anonymization service level without inventing a deadline", () => {
    // NFR22: public identity removal is due within seven days of the request.
    expect(summarizeLifecycle({ requestedAt: new Date("2026-07-28T00:00:00.000Z"), status: "RECEIVED", completedAt: null }, now))
      .toEqual({ status: "RECEIVED", dueAt: new Date("2026-08-04T00:00:00.000Z"), overdue: false, daysRemaining: 4 });
    expect(summarizeLifecycle({ requestedAt: new Date("2026-07-20T00:00:00.000Z"), status: "RECEIVED", completedAt: null }, now))
      .toMatchObject({ overdue: true, daysRemaining: 0 });
    expect(summarizeLifecycle({ requestedAt: new Date("2026-07-20T00:00:00.000Z"), status: "COMPLETED", completedAt: new Date("2026-07-21T00:00:00.000Z") }, now))
      .toMatchObject({ status: "COMPLETED", overdue: false });
    expect(summarizeLifecycle(null, now)).toBeNull();
  });
});

describe("sensitive field guard", () => {
  const detail: UserSecurityDetail = {
    id: "3f1c9d2e-8b47-4a5c-9f6d-2c1a7e5b3d90",
    username: "alice",
    nickname: "Alice",
    status: "ACTIVE",
    registeredAt: ago(60 * DAY),
    lastSeenAt: ago(2 * HOUR),
    activityBucket: "ACTIVE_24H",
    activeSessionCount: 2,
    roomCount: 3,
    ownedRoomCount: 1,
    restrictedRoomCount: 0,
    openReportCount: 0,
    communityRestricted: false,
    operatorRoles: [],
    governanceHistory: [{ id: "audit-1", action: "ACCOUNT_DISABLED", actor: "root_one", result: "SUCCESS", metadata: { reason: "多次违规" }, occurredAt: ago(DAY) }],
    anonymization: null,
  };

  it("passes a projection built only from non-sensitive fields", () => {
    expect(() => assertSafeUserSecurityPayload(detail)).not.toThrow();
  });

  it("names every field the console must never carry", () => {
    expect(FORBIDDEN_USER_SECURITY_KEYS.length).toBeGreaterThan(0);
    for (const key of ["passwordHash", "recoveryCodeHash", "tokenHash", "sessionToken", "ipAddress", "city", "latitude", "availablePoints", "selection"]) {
      expect(() => assertSafeUserSecurityPayload({ ...detail, [key]: "leaked" })).toThrowError(new RegExp(key, "i"));
    }
  });

  it("catches a leak nested inside audit metadata or a list", () => {
    expect(() => assertSafeUserSecurityPayload({ ...detail, governanceHistory: [{ ...detail.governanceHistory[0], metadata: { recovery_code: "FP-XXXX" } }] })).toThrow(/recovery_code/i);
    expect(() => assertSafeUserSecurityPayload({ rooms: [{ ledgerEntries: [] }] })).toThrow(/ledgerEntries/i);
    expect(() => assertSafeUserSecurityPayload({ a: { b: { c: { password: "x" } } } })).toThrow(/password/i);
  });

  it("does not trip on legitimate look-alike field names", () => {
    for (const key of ["activeSessionCount", "sessionCount", "lastSeenAt", "roomCount", "registeredAt"]) {
      expect(() => assertSafeUserSecurityPayload({ [key]: 1 })).not.toThrow();
    }
  });

  it("accepts an already-redacted audit field but not a real value under the same name", () => {
    // A governance timeline is redacted before it reaches an operator: the key
    // name survives with no value behind it, and that must not read as a leak.
    const redacted = { ...detail, governanceHistory: [{ ...detail.governanceHistory[0], metadata: { reason: "多次违规", sessionToken: REDACTION_MARKER } }] };
    expect(() => assertSafeUserSecurityPayload(redacted)).not.toThrow();
    expect(() => assertSafeUserSecurityPayload({ metadata: { sessionToken: `${REDACTION_MARKER} raw-token` } })).toThrow(/sessionToken/i);
    expect(() => assertSafeUserSecurityPayload({ metadata: { passwordHash: null } })).toThrow(/passwordHash/i);
  });
});
