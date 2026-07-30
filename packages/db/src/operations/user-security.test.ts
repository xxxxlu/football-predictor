import { assertSafeUserSecurityPayload } from "@pulse/domain";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { OperationError } from "./repository.js";
import { PostgresUserSecurityRepository } from "./user-security.js";

type Row = Record<string, unknown>;
type Respond = (query: string) => Row[];

/**
 * Fake sql that mirrors the two shapes this repository relies on: nested
 * fragments (`sql`…${sql`…`}…``) and `sql.begin`. Fragments are spliced into the
 * text so a test can assert on the query the roster actually issues.
 */
class FakeQuery {
  constructor(readonly strings: readonly string[], readonly values: readonly unknown[], private readonly run: (query: FakeQuery) => Promise<Row[]>) {}
  then<T, U>(resolve?: (rows: Row[]) => T | PromiseLike<T>, reject?: (reason: unknown) => U | PromiseLike<U>) {
    return this.run(this).then(resolve, reject);
  }
}

function flatten(query: FakeQuery): { text: string; values: unknown[] } {
  let text = "";
  const values: unknown[] = [];
  query.strings.forEach((chunk, index) => {
    text += chunk;
    if (index >= query.values.length) return;
    const value = query.values[index];
    if (value instanceof FakeQuery) { const inner = flatten(value); text += inner.text; values.push(...inner.values); }
    else { text += " $ "; values.push(value); }
  });
  return { text, values };
}

function fakeSql(respond: Respond, log?: { queries: string[]; values: unknown[] }) {
  const run = async (query: FakeQuery) => {
    const { text, values } = flatten(query);
    log?.queries.push(text.replace(/\s+/g, " ").trim());
    log?.values.push(...values);
    return respond(text);
  };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => new FakeQuery(strings, values, run);
  (sql as unknown as { begin: unknown }).begin = (handler: (tx: unknown) => Promise<unknown>) => handler(sql);
  return sql as unknown as postgres.Sql;
}

const clock = { now: () => new Date("2026-07-30T10:00:00.000Z") };
// Matched on `array_agg(g.role`, which only readOperatorAuthorization issues. The
// table name alone is no longer distinctive: the target lookup now names the same
// table to keep a colleague's account out of reach.
const grants = (rows: Row[]): Respond => (query) => (query.includes("array_agg(g.role") ? rows : []);
const AS_SUPER_ADMIN = [{ isSuperAdmin: true, roles: null }];
const AS_OPS_ADMIN = [{ isSuperAdmin: false, roles: ["OPERATIONS_ADMIN"] }];
const DENIED: Row[][] = [
  [{ isSuperAdmin: false, roles: null }],                        // an ordinary member
  [{ isSuperAdmin: false, roles: ["COMMUNITY_MODERATOR"] }],     // a duty that does not cover user security
  [],                                                            // unknown or disabled
];
const ROSTER_ROW = {
  id: "user-1", username: "alice", nickname: "Alice", status: "ACTIVE",
  lastSeenAt: "2026-07-26T10:00:00.000Z", activeSessionCount: 2, roomCount: 3,
  ownedRoomCount: 1, restrictedRoomCount: 1, openReportCount: 0,
};
const QUERY = { search: "", status: "ALL", activity: "ALL", restriction: "ALL", minRooms: 0, limit: 100 } as const;

describe("user security console reads", () => {
  it("refuses every caller without USER_SECURITY_READ before any roster query runs", async () => {
    for (const authorization of DENIED) {
      const log = { queries: [] as string[], values: [] as unknown[] };
      const repository = new PostgresUserSecurityRepository(fakeSql(grants(authorization), log), clock);
      for (const read of [repository.listUsers("caller-1", { ...QUERY }), repository.getUser("caller-1", "user-1"), repository.listAnonymizationRequests("caller-1")]) {
        const failure = await read.catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(OperationError);
        expect((failure as OperationError).status).toBe(403);
      }
      expect(log.queries.every((query) => query.includes("identity.operator_role_grants"))).toBe(true);
    }
  });

  it("lets an operations-admin read the roster and projects nothing sensitive", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresUserSecurityRepository(fakeSql((query) =>
      query.includes("identity.operator_role_grants") ? AS_OPS_ADMIN : [ROSTER_ROW], log), clock);
    const [summary] = await repository.listUsers("ops-1", { ...QUERY });
    expect(summary).toEqual({
      id: "user-1", username: "alice", nickname: "Alice", status: "ACTIVE",
      lastSeenAt: new Date("2026-07-26T10:00:00.000Z"), activityBucket: "ACTIVE_7D",
      activeSessionCount: 2, roomCount: 3, ownedRoomCount: 1, restrictedRoomCount: 1,
      openReportCount: 0, communityRestricted: true,
    });
    expect(() => assertSafeUserSecurityPayload(summary)).not.toThrow();

    // The projection must stay a count-and-timestamp view of accounts.
    const roster = log.queries.find((query) => query.includes('AS "activeSessionCount"'))!;
    for (const forbidden of ["password_hash", "recovery", "token_hash", "ip_address", "latitude", "selection", "stake_points", "available_points", "ledger"]) {
      expect(roster).not.toContain(forbidden);
    }
    // Search is literal containment, so a wildcard in the term cannot widen it.
    expect(roster).toContain("strpos(u.username_canonical");
    expect(roster).not.toContain("LIKE");
    expect(roster).toContain("u.is_super_admin = false");
    expect(log.values.some((value) => value instanceof Date)).toBe(false);
  });

  it("reads one account's own governance timeline without opening the platform-wide trail", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresUserSecurityRepository(fakeSql((query) => {
      if (query.includes("identity.operator_role_grants") && query.includes("is_super_admin")) return AS_OPS_ADMIN;
      if (query.includes("identity.operator_role_grants")) return [{ role: "COMMUNITY_MODERATOR" }];
      if (query.includes("FROM identity.users u")) return [{ ...ROSTER_ROW, registeredAt: "2026-01-05T00:00:00.000Z" }];
      if (query.includes("ops.privacy_requests")) return [{ status: "RECEIVED", requestedAt: "2026-07-28T10:00:00.000Z", completedAt: null }];
      return [{ id: "audit-1", actor: "root", action: "SESSIONS_REVOKED", target_type: "USER", target_id: "user-1", result: "SUCCESS", metadata: { reason: "安全复核", sessionToken: "raw" }, occurred_at: "2026-07-29T09:00:00.000Z" }];
    }, log), clock);

    const detail = await repository.getUser("ops-1", "user-1");
    expect(detail.registeredAt).toEqual(new Date("2026-01-05T00:00:00.000Z"));
    expect(detail.operatorRoles).toEqual(["COMMUNITY_MODERATOR"]);
    expect(detail.anonymization).toEqual({ status: "RECEIVED", dueAt: new Date("2026-08-04T10:00:00.000Z"), overdue: false, daysRemaining: 5 });
    // Timeline metadata goes through the shared redaction, so a leaked token in an
    // old audit row still cannot reach an operator.
    expect(detail.governanceHistory[0]).toMatchObject({ action: "SESSIONS_REVOKED", actor: "root", metadata: { reason: "安全复核", sessionToken: "[REDACTED]" } });
    // Every timeline query is scoped to this account, never to the whole platform.
    const timeline = log.queries.find((query) => query.includes("UNION ALL"))!;
    expect(timeline).toContain("e.target_user_id = $");
    expect(timeline).toContain("a.target_type = 'USER'");
    expect(() => assertSafeUserSecurityPayload(detail)).not.toThrow();
  });

  it("reports a missing or super-admin target as not found rather than leaking its existence", async () => {
    const repository = new PostgresUserSecurityRepository(fakeSql(grants(AS_SUPER_ADMIN)), clock);
    const failure = await repository.getUser("root-1", "ghost").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OperationError);
    expect((failure as OperationError).status).toBe(404);
  });
});

describe("user security console writes", () => {
  it("refuses a write without USER_SECURITY_WRITE before touching sessions or requests", async () => {
    for (const authorization of DENIED) {
      const log = { queries: [] as string[], values: [] as unknown[] };
      const repository = new PostgresUserSecurityRepository(fakeSql(grants(authorization), log), clock);
      for (const write of [
        repository.revokeSessions("caller-1", "user-1", "安全复核"),
        repository.fileAnonymizationRequest("caller-1", "user-1", "用户申请"),
        repository.completeAnonymizationRequest("caller-1", "user-1", "request-1", "用户申请"),
      ]) {
        const failure = await write.catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(OperationError);
        expect((failure as OperationError).status).toBe(403);
      }
      expect(log.queries.some((query) => query.includes("UPDATE identity.sessions") || query.includes("INSERT INTO ops.privacy_requests"))).toBe(false);
    }
  });

  it("ends every live session and records the count and reason in one audit row", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresUserSecurityRepository(fakeSql((query) => {
      if (query.includes("array_agg(g.role")) return AS_OPS_ADMIN;
      if (query.includes("FROM identity.users")) return [{ id: "user-1" }];
      if (query.includes("UPDATE identity.sessions")) return [{ userId: "user-1" }, { userId: "user-1" }];
      return [];
    }, log), clock);

    const result = await repository.revokeSessions("ops-1", "user-1", "安全复核：异常登录");
    expect(result).toMatchObject({ targetUserId: "user-1", revokedSessions: 2 });
    expect(result.auditId).toMatch(/^[0-9a-f-]{36}$/);
    const revoke = log.queries.find((query) => query.includes("UPDATE identity.sessions"))!;
    expect(revoke).toContain("revoked_at IS NULL");
    // Only the count leaves the database; no token or hash is selected.
    expect(revoke).toContain('RETURNING user_id AS "userId"');
    expect(log.queries.some((query) => query.includes("'SESSIONS_REVOKED'"))).toBe(true);
    expect(log.values).toContain(JSON.stringify({ reason: "安全复核：异常登录", revokedSessions: 2 }));
    // ::text::jsonb, not ::jsonb — a bare cast makes postgres.js encode the JSON
    // string a second time and the column stores a jsonb string, not an object.
    const audit = log.queries.find((query) => query.includes("'SESSIONS_REVOKED'"))!;
    expect(audit).toContain("::text::jsonb");
    expect(log.values.some((value) => value instanceof Date)).toBe(false);
  });

  it("refuses to act on a super-admin or an account that is not there", async () => {
    const repository = new PostgresUserSecurityRepository(fakeSql(grants(AS_SUPER_ADMIN)), clock);
    for (const write of [repository.revokeSessions("root-1", "root-2", "尝试"), repository.fileAnonymizationRequest("root-1", "root-2", "尝试处理")]) {
      const failure = await write.catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(OperationError);
      expect((failure as OperationError).code).toBe("TARGET_NOT_MANAGEABLE");
      expect((failure as OperationError).status).toBe(422);
    }
  });

  it("keeps a colleague's account out of reach: the target must hold no live duty", async () => {
    // Excluding the two super-admins is not enough. Disabling, signing out or
    // anonymizing an operations-admin would deny them every capability, making one
    // restricted duty a lever on another — reserved for OPERATOR_ROLE_MANAGE.
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresUserSecurityRepository(fakeSql(grants(AS_OPS_ADMIN), log), clock);
    await repository.revokeSessions("ops-1", "peer-1", "尝试处理同事账户").catch(() => undefined);
    const lookup = log.queries.find((query) => query.includes("FROM identity.users WHERE"))!;
    expect(lookup).toContain("NOT EXISTS");
    expect(lookup).toContain("identity.operator_role_grants");
    expect(lookup).toContain("revoked_at IS NULL");
    // Whether a real row is excluded is a database fact; this asserts the clause is
    // in the statement that locks the target, not merely checked somewhere earlier.
    expect(lookup).toContain("FOR UPDATE");
  });

  it("refuses to aim the console at the operator's own account", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresUserSecurityRepository(fakeSql(grants(AS_OPS_ADMIN), log), clock);
    for (const write of [
      repository.revokeSessions("ops-1", "ops-1", "退出所有设备"),
      repository.fileAnonymizationRequest("ops-1", "ops-1", "注销我自己"),
      repository.completeAnonymizationRequest("ops-1", "ops-1", "request-1", "注销我自己"),
    ]) {
      const failure = await write.catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(OperationError);
      expect((failure as OperationError).code).toBe("TARGET_NOT_MANAGEABLE");
    }
    expect(log.queries.some((query) => query.includes("UPDATE identity.sessions") || query.includes("INSERT INTO ops.privacy_requests"))).toBe(false);
  });

  it("keeps one open anonymization request per account", async () => {
    const repository = new PostgresUserSecurityRepository(fakeSql((query) => {
      if (query.includes("array_agg(g.role")) return AS_OPS_ADMIN;
      if (query.includes("FROM identity.users")) return [{ id: "user-1" }];
      if (query.includes("INSERT INTO ops.privacy_requests")) throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
      return [];
    }), clock);
    const failure = await repository.fileAnonymizationRequest("ops-1", "user-1", "用户来信申请").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OperationError);
    expect((failure as OperationError).code).toBe("ANONYMIZATION_REQUEST_EXISTS");
    expect((failure as OperationError).status).toBe(409);
  });

  it("starts the seven-day clock on a filed request and reports it in the queue", async () => {
    const repository = new PostgresUserSecurityRepository(fakeSql((query) => {
      if (query.includes("array_agg(g.role")) return AS_OPS_ADMIN;
      if (query.includes("FROM identity.users u")) return [];
      if (query.includes("FROM identity.users")) return [{ id: "user-1" }];
      if (query.includes("FROM ops.privacy_requests p")) return [{ id: "request-1", userId: "user-1", username: "alice", status: "RECEIVED", requestedAt: "2026-07-24T10:00:00.000Z", reason: "用户来信申请" }];
      return [];
    }), clock);
    await expect(repository.fileAnonymizationRequest("ops-1", "user-1", "用户来信申请")).resolves.toMatchObject({ status: "RECEIVED" });
    // Filed six days ago: one day left, not yet overdue.
    await expect(repository.listAnonymizationRequests("ops-1")).resolves.toEqual([
      { id: "request-1", userId: "user-1", username: "alice", reason: "用户来信申请", status: "RECEIVED", dueAt: new Date("2026-07-31T10:00:00.000Z"), overdue: false, daysRemaining: 1 },
    ]);
  });

  it("only completes a request that is still open, and anonymizes instead of deleting", async () => {
    // A manageable target with no open request: the refusal must name the request,
    // not the account.
    const closed = new PostgresUserSecurityRepository(fakeSql((query) => {
      if (query.includes("array_agg(g.role")) return AS_OPS_ADMIN;
      if (query.includes("FROM identity.users WHERE")) return [{ id: "user-1" }];
      return [];
    }), clock);
    const failure = await closed.completeAnonymizationRequest("ops-1", "user-1", "request-1", "按申请处理").catch((error: unknown) => error);
    expect((failure as OperationError).code).toBe("ANONYMIZATION_REQUEST_NOT_OPEN");
    expect((failure as OperationError).status).toBe(409);

    const log = { queries: [] as string[], values: [] as unknown[] };
    const open = new PostgresUserSecurityRepository(fakeSql((query) => {
      if (query.includes("array_agg(g.role")) return AS_OPS_ADMIN;
      if (query.includes("FROM ops.privacy_requests")) return [{ id: "request-1" }];
      if (query.includes("FROM identity.users")) return [{ superAdmin: false, username: "alice" }];
      return [];
    }, log), clock);
    await expect(open.completeAnonymizationRequest("ops-1", "user-1", "request-1", "按申请处理")).resolves.toMatchObject({ status: "COMPLETED" });
    // FR70: the identifying columns are overwritten in place, the row stays, and
    // the account is disabled rather than removed.
    const rewrite = log.queries.find((query) => query.includes("UPDATE identity.users"))!;
    expect(rewrite).toContain("username_canonical=");
    expect(rewrite).toContain("status='DISABLED'");
    expect(log.queries.some((query) => query.includes("UPDATE identity.sessions") && query.includes("revoked_at IS NULL"))).toBe(true);
    expect(log.queries.some((query) => query.includes("'ACCOUNT_ANONYMIZED'"))).toBe(true);
    for (const query of log.queries) {
      expect(query).not.toContain("DELETE FROM");
      for (const forbidden of ["ledger", "room.tickets", "SET available_points", "predictions"]) expect(query).not.toContain(forbidden);
    }
  });
});
