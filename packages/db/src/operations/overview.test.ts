import { DEFAULT_AUDIT_QUERY, HIGH_RISK_AUDIT_ACTIONS, type AuditQuery } from "@pulse/domain";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { PostgresOperationsOverviewRepository, type AdminStatus } from "./overview.js";
import type { OperatorAuthorization } from "../identity/operator-roles.js";
import { listGovernanceAudit } from "./moderation-privacy.js";
import { OperationError } from "./repository.js";

type Row = Record<string, unknown>;
type Respond = (query: string) => Row[];

/** Same fake sql shape as the governance inbox suite: nested fragments plus `begin`. */
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

const AS_SUPER_ADMIN = [{ isSuperAdmin: true, roles: null }];
const AS_OPS_ADMIN = [{ isSuperAdmin: false, roles: ["OPERATIONS_ADMIN"] }];
const AS_MODERATOR = [{ isSuperAdmin: false, roles: ["COMMUNITY_MODERATOR"] }];
const AS_MEMBER = [{ isSuperAdmin: false, roles: null }];

const STATUS: AdminStatus = {
  supplierBudget: { limit: 95, generalUsed: 20, settlementUsed: 1, settlementReserved: 10 },
  cache: { staleMatches: 0, unavailableMatches: 0, oldestDataAsOf: "2026-07-30T09:55:00.000Z" },
  settlement: { pending: 3, failed: 0 },
  jobs: { queued: 2, running: 1, failed: 1, maxLagSeconds: 30 },
};

/** A health reader that records the authorization it was handed, standing in for
 *  the existing aggregate. */
function healthStub(status: AdminStatus = STATUS) {
  const calls: OperatorAuthorization[] = [];
  return { calls, adminStatus: async (authorization: OperatorAuthorization) => { calls.push(authorization); return status; } };
}

function responder(authorization: Row[], extra?: Respond): Respond {
  return (query) => {
    if (query.includes("identity.operator_role_grants")) return authorization;
    return extra?.(query) ?? [];
  };
}

function overviewFor(authorization: Row[], extra?: Respond, log?: { queries: string[]; values: unknown[] }, health = healthStub()) {
  return { repository: new PostgresOperationsOverviewRepository(fakeSql(responder(authorization, extra), log), health, clock), health };
}

describe("operations overview", () => {
  it("refuses an account with no operational duty before any section query runs", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const { repository, health } = overviewFor(AS_MEMBER, undefined, log);
    const failure = await repository.overview("member-1").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OperationError);
    expect(failure).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(log.queries.every((query) => query.includes("identity.operator_role_grants"))).toBe(true);
    expect(health.calls).toEqual([]);
  });

  it("hands the health aggregate the authorization it already resolved", async () => {
    // The aggregate resolves the actor to decide which cards exist; the health
    // reader used to resolve the identical row again for its own capability
    // check. Passing it through keeps that check and drops the second read.
    const log = { queries: [] as string[], values: [] as unknown[] };
    const { repository, health } = overviewFor(AS_SUPER_ADMIN, undefined, log);
    await repository.overview("root-1");
    expect(health.calls).toHaveLength(1);
    expect(health.calls[0]?.capabilities).toContain("OPERATIONS_HEALTH_READ");
    // Match the authorization read specifically: the ROLE_CHANGES card queries
    // the same table for its own counts, so the table name alone over-matches.
    expect(log.queries.filter((query) => query.includes("array_agg(g.role"))).toHaveLength(1);
  });

  it("gives a super-admin every section", async () => {
    const { repository } = overviewFor(AS_SUPER_ADMIN);
    const overview = await repository.overview("root-1");
    expect(overview.sections.map((section) => section.card)).toEqual([
      "SUPPLIER_HEALTH", "SETTLEMENT_HEALTH", "JOB_HEALTH", "REPORT_QUEUE", "ACCOUNT_RISK", "ROLE_CHANGES", "HIGH_RISK_ACTIONS",
    ]);
  });

  it("never reads a section the actor has no capability for", async () => {
    // AC2: aggregation must not widen the read. A community moderator's overview
    // touches reports and nothing else — no health call, no account query, no
    // role-grant count beyond the authorization lookup itself.
    const log = { queries: [] as string[], values: [] as unknown[] };
    const { repository, health } = overviewFor(AS_MODERATOR, undefined, log);
    const overview = await repository.overview("mod-1");
    expect(overview.sections.map((section) => section.card)).toEqual(["REPORT_QUEUE"]);
    expect(health.calls).toEqual([]);
    const queries = log.queries.filter((query) => !query.includes("identity.operator_role_grants"));
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("FROM room.reports");
    for (const forbidden of ["identity.users WHERE status", "ops.privacy_requests", "prediction.tickets", "ops.jobs"]) {
      expect(log.queries.some((query) => query.includes(forbidden))).toBe(false);
    }
  });

  it("narrows the report queue to the kinds the duty covers", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const { repository } = overviewFor(AS_MODERATOR, undefined, log);
    await repository.overview("mod-1");
    // 12.4: the community duty spans both message kinds.
    expect(log.values).toContainEqual(["MESSAGE", "CHANNEL_MESSAGE"]);
    const ops = { queries: [] as string[], values: [] as unknown[] };
    await overviewFor(AS_OPS_ADMIN, undefined, ops).repository.overview("ops-1");
    expect(ops.values).toContainEqual(["ROOM"]);
  });

  it("hides the role-change section from an operations admin", async () => {
    const { repository } = overviewFor(AS_OPS_ADMIN);
    const overview = await repository.overview("ops-1");
    const cards = overview.sections.map((section) => section.card);
    expect(cards).toContain("ACCOUNT_RISK");
    expect(cards).not.toContain("ROLE_CHANGES");
    expect(cards).not.toContain("HIGH_RISK_ACTIONS");
  });

  it("attaches a next step only where the actor may act", async () => {
    const { repository } = overviewFor(AS_OPS_ADMIN);
    const overview = await repository.overview("ops-1");
    const jobs = overview.sections.find((section) => section.card === "JOB_HEALTH");
    expect(jobs?.nextStep?.capability).toBe("OPERATIONS_TASK_RETRY");
    const moderator = await overviewFor(AS_MODERATOR).repository.overview("mod-1");
    expect(moderator.sections[0]?.nextStep?.href).toBe("/admin/moderation");
  });

  it("derives the headline from the sections the actor can see", async () => {
    // One failed job is critical for whoever can act on it…
    const { repository } = overviewFor(AS_OPS_ADMIN);
    expect((await repository.overview("ops-1")).overall).toBe("ACT");
    // …and invisible to a moderator whose only section is an empty queue.
    expect((await overviewFor(AS_MODERATOR).repository.overview("mod-1")).overall).toBe("OK");
  });

  it("computes remaining supplier quota net of the settlement reserve", async () => {
    const { repository } = overviewFor(AS_OPS_ADMIN);
    const overview = await repository.overview("ops-1");
    const supplier = overview.sections.find((section) => section.card === "SUPPLIER_HEALTH");
    expect(supplier?.metrics.find((metric) => metric.key === "generalRemaining")?.value).toBe(65);
  });

  it("counts an unsettled ticket as overdue for both sports", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const { repository } = overviewFor(AS_OPS_ADMIN, undefined, log);
    await repository.overview("ops-1");
    const settlement = log.queries.find((query) => query.includes("FROM prediction.tickets"))!;
    expect(settlement).toContain("LEFT JOIN supplier.fixtures");
    expect(settlement).toContain("LEFT JOIN f1.sessions");
  });

  it("exposes no balance, stake, selection or ledger figure in any section", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const { repository } = overviewFor(AS_SUPER_ADMIN, undefined, log);
    const overview = await repository.overview("root-1");
    const serialized = JSON.stringify(overview);
    for (const word of ["availablePoints", "stake", "selection", "ledger", "balance"]) {
      expect(serialized.toLowerCase()).not.toContain(word.toLowerCase());
    }
    // FR59: the overview reads counts. It must never touch the ledger at all.
    expect(log.queries.some((query) => query.includes("ledger."))).toBe(false);
  });
});

describe("failed job queue", () => {
  it("requires the health capability", async () => {
    const { repository } = overviewFor(AS_MODERATOR);
    await expect(repository.listFailedJobs("mod-1")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("returns only the operational shape of a failure", async () => {
    const rows = [{ id: "job-1", kind: "supplier:odds", attempt: 3, runCount: 3, lastErrorCode: "SUPPLIER_TIMEOUT", availableAt: "2026-07-30T09:00:00.000Z", updatedAt: "2026-07-30T09:30:00.000Z" }];
    const { repository } = overviewFor(AS_OPS_ADMIN, (query) => (query.includes("FROM ops.jobs") ? rows : []));
    const jobs = await repository.listFailedJobs("ops-1");
    // Never the payload and never last_error_detail: one can name a fixture, the
    // other is supplier free text.
    expect(Object.keys(jobs[0]!).sort()).toEqual(["attempt", "availableAt", "id", "kind", "lastErrorCode", "runCount", "updatedAt"]);
  });

  it("reads the payload out of neither the projection nor the query", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const { repository } = overviewFor(AS_OPS_ADMIN, undefined, log);
    await repository.listFailedJobs("ops-1");
    const read = log.queries.find((query) => query.includes("FROM ops.jobs"))!;
    expect(read).not.toContain("payload");
    expect(read).not.toContain("last_error_detail");
  });
});

describe("safe task retry", () => {
  const failedJob = [{ id: "job-1", kind: "supplier:odds", status: "FAILED", attempt: 3, lastErrorCode: "SUPPLIER_TIMEOUT" }];
  const requeued = [{ id: "job-1", status: "QUEUED", availableAt: "2026-07-30T10:00:00.000Z" }];

  function retryResponder(job: Row[], updated: Row[] = requeued): Respond {
    return (query) => {
      if (query.includes("FOR UPDATE")) return job;
      if (query.includes("UPDATE ops.jobs")) return updated;
      return [];
    };
  }

  it("requires the retry capability, which no read-only duty holds", async () => {
    const { repository } = overviewFor(AS_MODERATOR, retryResponder(failedJob));
    await expect(repository.retryJob("mod-1", "job-1", "供应商超时，重试一次")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("re-queues a failed job and clears only its backoff wait", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const { repository } = overviewFor(AS_OPS_ADMIN, retryResponder(failedJob), log);
    const result = await repository.retryJob("ops-1", "job-1", "供应商超时，重试一次");
    expect(result).toMatchObject({ jobId: "job-1", status: "QUEUED", availableAt: "2026-07-30T10:00:00.000Z" });
    const update = log.queries.find((query) => query.includes("UPDATE ops.jobs"))!;
    expect(update).toContain("status = 'QUEUED'");
    expect(update).toContain("available_at");
    // The retry re-runs the same work: payload, attempt, run_count and result stay
    // exactly as the failure left them, so no odds or settlement can be rewritten.
    for (const column of ["payload", "attempt", "run_count", "result", "last_error"]) {
      expect(update).not.toContain(column);
    }
  });

  it("only ever moves a job out of FAILED", async () => {
    const update = "UPDATE ops.jobs";
    const log = { queries: [] as string[], values: [] as unknown[] };
    const { repository } = overviewFor(AS_OPS_ADMIN, retryResponder(failedJob), log);
    await repository.retryJob("ops-1", "job-1", "供应商超时，重试一次");
    expect(log.queries.find((query) => query.includes(update))).toContain("AND status = 'FAILED'");
  });

  it("refuses a job that is not a settled failure", async () => {
    for (const status of ["QUEUED", "RUNNING", "SUCCEEDED"]) {
      const { repository } = overviewFor(AS_OPS_ADMIN, retryResponder([{ ...failedJob[0], status }]));
      await expect(repository.retryJob("ops-1", "job-1", "供应商超时，重试一次")).rejects.toMatchObject({ code: "JOB_NOT_RETRYABLE", status: 409 });
    }
  });

  it("reports a missing job as not found", async () => {
    const { repository } = overviewFor(AS_OPS_ADMIN, retryResponder([]));
    await expect(repository.retryJob("ops-1", "job-404", "供应商超时，重试一次")).rejects.toMatchObject({ code: "JOB_NOT_FOUND", status: 404 });
  });

  it("loses the race rather than double-queueing", async () => {
    // Another operator re-queued the same job between the lock and the update.
    const { repository } = overviewFor(AS_OPS_ADMIN, retryResponder(failedJob, []));
    await expect(repository.retryJob("ops-1", "job-1", "供应商超时，重试一次")).rejects.toMatchObject({ code: "JOB_NOT_RETRYABLE", status: 409 });
  });

  it("writes one audit row naming the job, with the reason and no free-text error", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const { repository } = overviewFor(AS_OPS_ADMIN, retryResponder(failedJob), log);
    const result = await repository.retryJob("ops-1", "job-1", "供应商超时，重试一次");
    const audit = log.queries.filter((query) => query.includes("INSERT INTO ops.audit_events"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toContain("'JOB_RETRY_REQUESTED','JOB'");
    // `::text::jsonb`, never a bare `::jsonb`: postgres.js would double-encode.
    expect(audit[0]).toContain("::text::jsonb");
    expect(log.values).toContain(result.auditId);
    expect(log.values).toContain(JSON.stringify({ kind: "supplier:odds", attempt: 3, lastErrorCode: "SUPPLIER_TIMEOUT", reason: "供应商超时，重试一次" }));
  });
});

describe("unified audit trail", () => {
  const auditRow = {
    id: "audit-1", actor: "运营小李", action: "OPERATOR_ROLE_GRANTED", target_type: "USER",
    target_id: "user-1", result: "SUCCESS", metadata: { role: "OPERATIONS_ADMIN", sessionToken: "leaked" },
    occurred_at: "2026-07-30T09:00:00.000Z",
  };
  const query = (overrides: Partial<AuditQuery> = {}): AuditQuery => ({ ...DEFAULT_AUDIT_QUERY, ...overrides });

  it("requires AUDIT_READ, which neither restricted duty holds", async () => {
    for (const authorization of [AS_OPS_ADMIN, AS_MODERATOR]) {
      const { repository } = overviewFor(authorization);
      await expect(repository.listAudit("ops-1", query())).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    }
  });

  it("gates itself, not just its caller", async () => {
    // The merged read is the whole platform-wide trail, so the capability check
    // belongs to it: reaching it directly must not be a way around AUDIT_READ.
    const log = { queries: [] as string[], values: [] as unknown[] };
    for (const authorization of [AS_OPS_ADMIN, AS_MODERATOR, AS_MEMBER]) {
      await expect(listGovernanceAudit(fakeSql(responder(authorization), log), "ops-1", query()))
        .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    }
    // Refused before the trail is touched, not after.
    expect(log.queries.every((query) => query.includes("identity.operator_role_grants"))).toBe(true);
  });

  it("merges all three audit tables", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    await listGovernanceAudit(fakeSql(responder(AS_SUPER_ADMIN), log), "root-1", query());
    const merged = log.queries[1]!;
    for (const table of ["ops.audit_events", "identity.admin_account_audit_events", "room.audit_events"]) {
      expect(merged).toContain(table);
    }
    expect(merged).toContain("ORDER BY merged.occurred_at DESC");
  });

  it("binds no action predicate when the trail is unfiltered", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    await listGovernanceAudit(fakeSql(responder(AS_SUPER_ADMIN), log), "root-1", query());
    // postgres.js cannot infer an element type for an empty array, so the
    // predicate has to disappear from the SQL rather than bind `= ANY('{}')`.
    expect(log.queries[1]).not.toContain("merged.action = ANY");
    expect(log.values).not.toContainEqual([]);
  });

  it("expands a group filter into its whole family", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    await listGovernanceAudit(fakeSql(responder(AS_SUPER_ADMIN), log), "root-1", query({ group: "ROLE" }));
    expect(log.queries[1]).toContain("merged.action = ANY");
    expect(log.values).toContainEqual(["OPERATOR_ROLE_GRANTED", "OPERATOR_ROLE_REVOKED"]);
  });

  it("applies every documented filter dimension", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    await listGovernanceAudit(fakeSql(responder(AS_SUPER_ADMIN), log), "root-1", query({
      actor: "ops_admin", targetType: "ROOM", targetId: "room-1", action: "ROOM_CLOSE", group: "ROOM",
      result: "FAILURE", from: new Date("2026-07-01T00:00:00.000Z"), to: new Date("2026-07-30T00:00:00.000Z"),
      correlationId: "audit-1", limit: 25,
    }));
    const sql = log.queries[1]!;
    expect(sql).toContain("strpos(COALESCE(u.username_canonical, ''),");
    expect(sql).toContain("merged.target_type =");
    expect(sql).toContain("merged.target_id =");
    expect(sql).toContain("merged.result =");
    expect(sql).toContain("merged.occurred_at >=");
    // Exclusive upper bound: `occurred_at` is microsecond precision, so an
    // inclusive bound built from a millisecond literal would clip the range.
    expect(sql).toContain("merged.occurred_at <");
    expect(sql).not.toContain("merged.occurred_at <=");
    expect(sql).toContain("merged.id =");
    expect(log.values).toContain("ops_admin");
    expect(log.values).toContain("audit-1");
    expect(log.values).toContain(25);
    // Timestamps cross the wire as ISO strings: the Next.js runtime instruments
    // Date, which defeats postgres.js's instanceof-based type inference.
    expect(log.values).toContain("2026-07-01T00:00:00.000Z");
  });

  it("redacts a secret a writer should never have stored", async () => {
    const [event] = await listGovernanceAudit(fakeSql(responder(AS_SUPER_ADMIN, () => [auditRow])), "root-1", query());
    expect((event!.metadata as Record<string, unknown>).role).toBe("OPERATIONS_ADMIN");
    expect((event!.metadata as Record<string, unknown>).sessionToken).not.toBe("leaked");
    expect(event!.occurredAt).toBe("2026-07-30T09:00:00.000Z");
  });

  it("keeps the repository's high-risk set identical to the domain's", async () => {
    // The repository binds a mutable array for the postgres.js encoder, so the two
    // lists are pinned here rather than by an import.
    const log = { queries: [] as string[], values: [] as unknown[] };
    const { repository } = overviewFor(AS_SUPER_ADMIN, undefined, log);
    await repository.overview("root-1");
    expect(log.values).toContainEqual([...HIGH_RISK_AUDIT_ACTIONS]);
  });
});
