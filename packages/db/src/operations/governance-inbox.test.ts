import { assertMinimalReportContext, AuthError, type GovernanceInboxQuery } from "@pulse/domain";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { PostgresGovernanceInboxRepository } from "./governance-inbox.js";
import { OperationError } from "./repository.js";

type Row = Record<string, unknown>;
type Respond = (query: string) => Row[];

/** Same fake sql shape as the user security suite: nested fragments plus `begin`. */
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
const QUERY: GovernanceInboxQuery = { kind: "ALL", status: "PENDING", severity: "ALL", assignee: "ALL", limit: 100 };

const AS_OPS_ADMIN = [{ isSuperAdmin: false, roles: ["OPERATIONS_ADMIN"] }];
const AS_MODERATOR = [{ isSuperAdmin: false, roles: ["COMMUNITY_MODERATOR"] }];
const AS_MEMBER = [{ isSuperAdmin: false, roles: null }];

const ROOM_REPORT = {
  reportId: "report-room", kind: "ROOM", severity: "HIGH", status: "OPEN", reason: "房主刷屏拉人",
  reporterUserId: "member-1", reporter: "阿明", assignedTo: null, assignee: null, subject: "周末德甲",
  createdAt: "2026-07-29T10:00:00.000Z", updatedAt: "2026-07-29T10:00:00.000Z",
};
const MESSAGE_REPORT = { ...ROOM_REPORT, reportId: "report-message", kind: "MESSAGE", subject: "阿强" };
const ROOM_TARGET = {
  reportId: "report-room", kind: "ROOM", status: "OPEN", reporterUserId: "member-1", assignedTo: null,
  roomId: "room-1", roomName: "周末德甲", roomStatus: "ACTIVE", roomOwnerId: "owner-1", messageId: null, subjectUserId: null,
};
const MESSAGE_TARGET = { ...ROOM_TARGET, reportId: "report-message", kind: "MESSAGE", messageId: "message-1", subjectUserId: "author-1" };

/** Routes a query to the right canned rows. `FOR UPDATE OF rp` is what separates the lock from the queue read. */
function responder(authorization: Row[], rows: { report?: Row; target?: Row; extra?: Respond } = {}): Respond {
  return (query) => {
    if (query.includes("identity.operator_role_grants")) return authorization;
    if (query.includes("FOR UPDATE OF rp")) return rows.target ? [rows.target] : [];
    if (query.includes('AS "reportId"') && query.includes("LEFT JOIN identity.users assignee")) return rows.report ? [rows.report] : [];
    return rows.extra?.(query) ?? [];
  };
}

describe("governance inbox reads", () => {
  it("refuses the queue to an account with no report duty, before any report query runs", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MEMBER), log), clock);
    const failure = await repository.listReports("member-1", { ...QUERY }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AuthError);
    expect(failure).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(log.queries.every((query) => query.includes("identity.operator_role_grants"))).toBe(true);
  });

  it("narrows the queue to the kinds each duty owns", async () => {
    // 12.4: the community duty now spans both message kinds; the room duty is unchanged.
    for (const [authorization, kinds] of [[AS_OPS_ADMIN, ["ROOM"]], [AS_MODERATOR, ["MESSAGE", "CHANNEL_MESSAGE"]]] as const) {
      const log = { queries: [] as string[], values: [] as unknown[] };
      const repository = new PostgresGovernanceInboxRepository(fakeSql(responder(authorization, { report: ROOM_REPORT }), log), clock);
      await repository.listReports("operator-1", { ...QUERY });
      const queue = log.queries.find((query) => query.includes("rp.kind = ANY"))!;
      expect(queue).toContain("rp.status = ANY");
      expect(log.values).toContainEqual([...kinds]);
      expect(log.values).toContainEqual(["OPEN", "ASSIGNED"]);
    }
  });

  it("refuses a kind filter outside the caller's duty instead of quietly returning nothing", async () => {
    const moderator = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR)), clock);
    const opsAdmin = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_OPS_ADMIN)), clock);
    for (const attempt of [moderator.listReports("mod-1", { ...QUERY, kind: "ROOM" }), opsAdmin.listReports("ops-1", { ...QUERY, kind: "MESSAGE" })]) {
      await expect(attempt).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    }
  });

  it("hides the other surface's report behind not-found rather than confirming it exists", async () => {
    // Cross-surface access: a moderator holding a room report's id learns nothing.
    const moderator = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, { report: ROOM_REPORT })), clock);
    await expect(moderator.getReport("mod-1", "report-room")).rejects.toMatchObject({ code: "REPORT_NOT_FOUND", status: 404 });
    const opsAdmin = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_OPS_ADMIN, { report: MESSAGE_REPORT })), clock);
    await expect(opsAdmin.getReport("ops-1", "report-message")).rejects.toMatchObject({ code: "REPORT_NOT_FOUND", status: 404 });
  });

  it("gives a moderator the reported message and nothing around it", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, {
      report: MESSAGE_REPORT,
      extra: (query) => {
        if (query.includes("rp.reported_excerpt AS body")) return [{ messageId: "message-1", roomName: "周末德甲", author: "阿强", body: "被举报的原话", sentAt: "2026-07-29T09:59:00.000Z", hidden: false, mutedUntil: null }];
        if (query.includes("ops.audit_events")) return [{ id: "audit-1", actor: "阿明", action: "MESSAGE_REPORTED", target_type: "REPORT", target_id: "report-message", result: "SUCCESS", metadata: { reportId: "report-message" }, occurred_at: "2026-07-29T10:00:00.000Z" }];
        return [];
      },
    }), log), clock);

    const detail = await repository.getReport("mod-1", "report-message");
    expect(detail.room).toBeNull();
    expect(Object.keys(detail.message!).sort()).toEqual(["author", "body", "hidden", "messageId", "mutedUntil", "roomName", "sentAt"]);
    expect(detail.availableDispositions).toEqual(["HIDE_MESSAGE", "RESTORE_MESSAGE", "MUTE_MEMBER", "DISMISS"]);
    expect(detail.history[0]).toMatchObject({ action: "MESSAGE_REPORTED", actor: "阿明" });
    expect(() => assertMinimalReportContext(detail)).not.toThrow();
    // No room roster, no member list, no ticket or ledger read anywhere in the detail.
    for (const query of log.queries) {
      for (const forbidden of ["prediction.tickets", "ledger.", "stake_points", "available_points", "room.members m WHERE"]) expect(query).not.toContain(forbidden);
    }
  });

  it("gives an operations-admin room context and the room dispositions only", async () => {
    const repository = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_OPS_ADMIN, {
      report: ROOM_REPORT,
      extra: (query) => query.includes('AS "memberCount"') ? [{ roomId: "room-1", roomName: "周末德甲", roomStatus: "ACTIVE", memberCount: 6, openReportCount: 2 }] : [],
    })), clock);
    const detail = await repository.getReport("ops-1", "report-room");
    expect(detail.message).toBeNull();
    expect(detail.room).toEqual({ roomId: "room-1", roomName: "周末德甲", roomStatus: "ACTIVE", memberCount: 6, openReportCount: 2 });
    expect(detail.availableDispositions).toEqual(["RESTRICT_ROOM", "CLOSE_ROOM", "RESTORE_ROOM", "DISMISS"]);
    expect(() => assertMinimalReportContext(detail)).not.toThrow();
  });
});

describe("governance inbox dispositions", () => {
  it("refuses a disposition that does not belong to the report's kind", async () => {
    const moderator = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, { target: MESSAGE_TARGET })), clock);
    await expect(moderator.resolveReport("mod-1", "report-message", { disposition: "CLOSE_ROOM", reason: "越权尝试" }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST", status: 422 });
  });

  it("refuses a write to an operator whose duty does not cover that kind, before any state changes", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    // An operations-admin can see room reports but holds no community duty: the
    // message report is not theirs at all, so it reads as not found.
    const opsAdmin = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_OPS_ADMIN, { target: MESSAGE_TARGET }), log), clock);
    await expect(opsAdmin.resolveReport("ops-1", "report-message", { disposition: "HIDE_MESSAGE", reason: "越权尝试" }))
      .rejects.toMatchObject({ code: "REPORT_NOT_FOUND", status: 404 });
    expect(log.queries.some((query) => query.startsWith("UPDATE") || query.includes("INSERT INTO"))).toBe(false);
  });

  it("closes a room, settles every open filing against it and explains itself to the owner and each reporter", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_OPS_ADMIN, {
      target: ROOM_TARGET,
      extra: (query) => query.includes("UPDATE room.reports SET status")
        ? [{ reportId: "report-room", reporterUserId: "member-1" }, { reportId: "report-sibling", reporterUserId: "member-2" }]
        : [],
    }), log), clock);

    const result = await repository.resolveReport("ops-1", "report-room", { disposition: "CLOSE_ROOM", reason: "反复违规拉人，关闭房间" });
    expect(result).toMatchObject({ status: "RESOLVED", disposition: "CLOSE_ROOM", notifiedUsers: 3 });
    expect(log.queries.some((query) => query.includes("UPDATE room.rooms SET status"))).toBe(true);
    expect(log.values).toContain("CLOSED");
    const settle = log.queries.find((query) => query.includes("UPDATE room.reports SET status"))!;
    expect(settle).toContain("status IN ('OPEN','ASSIGNED')");
    expect(settle).toContain("kind = 'ROOM'");

    // Immutable audit, written the only way that survives postgres.js encoding.
    const audit = log.queries.find((query) => query.includes("INSERT INTO ops.audit_events"))!;
    expect(audit).toContain("::text::jsonb");
    // Two entries: the decision, filed under the report, and what it did to the
    // room, filed under the room so a search by room or by high-risk action finds
    // the closure that was reached through a report.
    expect(log.values).toContain("REPORT");
    expect(log.values).toContain("ROOM");
    expect(log.values).toContain("ROOM_CLOSE");
    expect(log.values).toContain("room-1");
    const metadata = log.values.filter((value): value is string => typeof value === "string" && value.startsWith("{")).map((value) => JSON.parse(value) as Record<string, unknown>);
    const decision = metadata.find((entry) => entry.resolvedReports !== undefined)!;
    expect(decision).toMatchObject({ reportId: "report-room", kind: "ROOM", disposition: "CLOSE_ROOM", reason: "反复违规拉人，关闭房间", roomStatus: "CLOSED", resolvedReports: 2 });
    // The room entry points back at the decision that produced it, so either half
    // of the pair leads to the other.
    const roomEntry = metadata.find((entry) => entry.roomStatus !== undefined && entry.resolutionAuditId !== undefined)!;
    expect(roomEntry).toMatchObject({ reportId: "report-room", roomStatus: "CLOSED", resolutionAuditId: result.auditId });
    expect(decision.roomAuditId).toEqual(expect.any(String));
    // Every other filing this decision closed gets an entry of its own, or it would
    // read as resolved with an empty timeline. The decision is not duplicated.
    const carried = metadata.filter((entry) => entry.resolutionAuditId === result.auditId && entry.roomStatus === undefined);
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ reportId: "report-sibling", disposition: "CLOSE_ROOM", reason: "反复违规拉人，关闭房间" });
    expect(log.values).toContain("report-sibling");

    // One notice per affected account, each carrying the same reason as the audit.
    const notices = log.queries.filter((query) => query.includes("INSERT INTO ops.governance_notices"));
    expect(notices).toHaveLength(3);
    expect(log.values).toContain("ROOM_CLOSED");
    expect(log.values.filter((value) => value === "反复违规拉人，关闭房间")).toHaveLength(4);
    // FR59 holds: no points, no prediction, no ledger row is touched by a disposition.
    for (const query of log.queries) {
      for (const forbidden of ["ledger.", "prediction.", "available_points", "DELETE FROM"]) expect(query).not.toContain(forbidden);
    }
  });

  it("hides a reported message without deleting it, and restores it again", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const hide = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, { target: MESSAGE_TARGET }), log), clock);
    await expect(hide.resolveReport("mod-1", "report-message", { disposition: "HIDE_MESSAGE", reason: "人身攻击" }))
      .resolves.toMatchObject({ status: "RESOLVED", notifiedUsers: 2 });
    const hidden = log.queries.find((query) => query.includes("INSERT INTO room.message_moderation"))!;
    expect(hidden).toContain("ON CONFLICT (message_id) DO UPDATE");
    expect(log.queries.every((query) => !query.includes("DELETE FROM"))).toBe(true);
    // Deferred-work gap ②: beside the decision entry (filed under the report), a
    // member-side entry filed under the author's account, each pointing at the
    // other — a search by user now surfaces what happened to their message.
    expect(log.values).toContain("MESSAGE_HIDDEN");
    expect(log.values).toContain("USER");
    expect(log.values).toContain("author-1");
    const hideMetadata = log.values.filter((value): value is string => typeof value === "string" && value.startsWith("{")).map((value) => JSON.parse(value) as Record<string, unknown>);
    const memberSide = hideMetadata.find((entry) => entry.resolutionAuditId !== undefined)!;
    expect(memberSide).toMatchObject({ reportId: "report-message", messageId: "message-1", reason: "人身攻击" });
    const decisionSide = hideMetadata.find((entry) => entry.memberAuditId !== undefined)!;
    expect(decisionSide.memberAuditId).toEqual(expect.any(String));

    // Restoring something that is not hidden is a conflict, not a silent success.
    const missing = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, { target: { ...MESSAGE_TARGET, status: "OPEN" } })), clock);
    await expect(missing.resolveReport("mod-1", "report-message", { disposition: "RESTORE_MESSAGE", reason: "复核后恢复" }))
      .rejects.toMatchObject({ code: "MESSAGE_NOT_HIDDEN", status: 409 });

    const restoreLog = { queries: [] as string[], values: [] as unknown[] };
    const restore = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, {
      target: MESSAGE_TARGET,
      extra: (query) => query.includes("UPDATE room.message_moderation") ? [{ messageId: "message-1" }] : [],
    }), restoreLog), clock);
    await expect(restore.resolveReport("mod-1", "report-message", { disposition: "RESTORE_MESSAGE", reason: "复核后恢复" }))
      .resolves.toMatchObject({ status: "RESOLVED" });
    expect(restoreLog.values).toContain("MESSAGE_RESTORED");
  });

  it("issues a temporary mute with an explicit window, and never an open-ended one", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, { target: MESSAGE_TARGET }), log), clock);
    await expect(repository.resolveReport("mod-1", "report-message", { disposition: "MUTE_MEMBER", reason: "连续辱骂" }))
      .rejects.toMatchObject({ code: "MUTE_DURATION_REQUIRED", status: 422 });

    await expect(repository.resolveReport("mod-1", "report-message", { disposition: "MUTE_MEMBER", reason: "连续辱骂", muteHours: 24 }))
      .resolves.toMatchObject({ status: "RESOLVED", notifiedUsers: 2 });
    // An expired window is closed out first so the "one live mute" index cannot
    // block a legitimate later mute.
    const expire = log.queries.find((query) => query.includes("SET lifted_at = muted_until"))!;
    expect(expire).toContain("lifted_at IS NULL");
    expect(log.values).toContain("2026-07-31T10:00:00.000Z");
    expect(log.values).toContain("MEMBER_MUTED");
  });

  it("reports a stacked mute as a conflict", async () => {
    const repository = new PostgresGovernanceInboxRepository(fakeSql((query) => {
      if (query.includes("identity.operator_role_grants")) return AS_MODERATOR;
      if (query.includes("FOR UPDATE OF rp")) return [MESSAGE_TARGET];
      if (query.includes("INSERT INTO room.member_mutes")) throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
      return [];
    }), clock);
    await expect(repository.resolveReport("mod-1", "report-message", { disposition: "MUTE_MEMBER", reason: "连续辱骂", muteHours: 1 }))
      .rejects.toMatchObject({ code: "MUTE_ALREADY_ACTIVE", status: 409 });
  });

  it("never reopens a report that is already closed", async () => {
    const repository = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_OPS_ADMIN, { target: { ...ROOM_TARGET, status: "RESOLVED" } })), clock);
    await expect(repository.resolveReport("ops-1", "report-room", { disposition: "RESTORE_ROOM", reason: "复核后恢复房间" }))
      .rejects.toMatchObject({ code: "REPORT_ALREADY_CLOSED", status: 409 });
    await expect(repository.triageReport("ops-1", "report-room", { assign: "ME" }))
      .rejects.toMatchObject({ code: "REPORT_ALREADY_CLOSED", status: 409 });
  });

  it("lifts a mute early as a first-class, audited reversal", async () => {
    const denied = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, { target: MESSAGE_TARGET })), clock);
    await expect(denied.liftMute("mod-1", "report-message", "复核后解除禁言"))
      .rejects.toMatchObject({ code: "MUTE_NOT_ACTIVE", status: 409 });

    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, {
      target: MESSAGE_TARGET,
      extra: (query) => query.includes("SET lifted_by") ? [{ userId: "author-1" }] : [],
    }), log), clock);
    await expect(repository.liftMute("mod-1", "report-message", "复核后解除禁言")).resolves.toMatchObject({ lifted: true });
    // The audit action plus one notice each for the muted member and the reporter.
    expect(log.values.filter((value) => value === "MEMBER_UNMUTED")).toHaveLength(3);
    expect(log.queries.filter((query) => query.includes("INSERT INTO ops.governance_notices"))).toHaveLength(2);
    expect(log.queries.some((query) => query.includes("INSERT INTO ops.audit_events") && query.includes("::text::jsonb"))).toBe(true);
  });

  it("refuses a room decision that would leave the room exactly where it is", async () => {
    // "Restore" on a room that was never restricted changes nothing about the room
    // but closes every open filing against it — the queue emptied as a favour. A
    // closure has to be a decision that acts on what was reported.
    const repository = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_OPS_ADMIN, {
      target: { ...ROOM_TARGET, roomStatus: "ACTIVE" },
    })), clock);
    await expect(repository.resolveReport("root-1", "report-room", { disposition: "RESTORE_ROOM", reason: "看起来没问题，恢复房间" }))
      .rejects.toMatchObject({ code: "ROOM_ALREADY_IN_STATE", status: 409 });
  });

  it("claims a report without asking for a reason, and records who claimed it", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, {
      target: MESSAGE_TARGET,
      extra: (query) => query.includes("UPDATE room.reports SET") ? [{ reportId: "report-message", status: "ASSIGNED", severity: "HIGH" }] : [],
    }), log), clock);
    await expect(repository.triageReport("mod-1", "report-message", { assign: "ME", severity: "HIGH" }))
      .resolves.toMatchObject({ status: "ASSIGNED", severity: "HIGH" });
    expect(log.values).toContain("REPORT_TRIAGED");
    // Triage is invisible to members, so it explains nothing to anyone.
    expect(log.queries.some((query) => query.includes("ops.governance_notices"))).toBe(false);
  });

  it("records the previous holder when a claim is taken over", async () => {
    // Taking over a colleague's claim is ordinary triage, but it must not be
    // silent: without the previous holder in the audit metadata the chain of
    // responsibility for a report simply changes hands with no trace.
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, {
      target: { ...MESSAGE_TARGET, status: "ASSIGNED", assignedTo: "mod-2" },
      extra: (query) => query.includes("UPDATE room.reports SET") ? [{ reportId: "report-message", status: "ASSIGNED", severity: "NORMAL" }] : [],
    }), log), clock);
    await repository.triageReport("mod-1", "report-message", { assign: "ME" });
    const metadata = log.values.filter((value): value is string => typeof value === "string" && value.startsWith("{")).map((value) => JSON.parse(value) as Record<string, unknown>);
    expect(metadata.some((entry) => entry.takenFrom === "mod-2")).toBe(true);
  });

  it("leaves the severity of an unclaimed report adjustable", async () => {
    // An unclaimed report stays OPEN when only its severity changes, so this used
    // to be refused as an invalid OPEN → OPEN transition — the one triage action
    // the inbox promised but could never perform.
    const repository = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, {
      target: { ...MESSAGE_TARGET, status: "OPEN", assignedTo: null },
      extra: (query) => query.includes("UPDATE room.reports SET") ? [{ reportId: "report-message", status: "OPEN", severity: "HIGH" }] : [],
    })), clock);
    await expect(repository.triageReport("mod-1", "report-message", { severity: "HIGH" }))
      .resolves.toMatchObject({ status: "OPEN", severity: "HIGH" });
  });
});

describe("filing a message report", () => {
  const filing = { messageId: "message-1", roomId: "room-1", reporterUserId: "member-9", reason: "人身攻击" };

  it("only accepts a reporter who is in the room, and refuses a second open filing", async () => {
    const outsider = new PostgresGovernanceInboxRepository(fakeSql(() => []), clock);
    await expect(outsider.reportMessage(filing)).rejects.toMatchObject({ code: "ROOM_NOT_FOUND", status: 404 });

    const duplicate = new PostgresGovernanceInboxRepository(fakeSql((query) =>
      query.includes("SELECT id FROM room.reports") ? [{ id: "report-message" }] : []), clock);
    await expect(duplicate.reportMessage(filing)).rejects.toMatchObject({ code: "REPORT_ALREADY_OPEN", status: 409 });
  });

  it("names a self-report instead of disguising it as not-found", async () => {
    const repository = new PostgresGovernanceInboxRepository(fakeSql((query) =>
      query.includes("SELECT msg.id FROM room.messages msg") ? [{ id: "message-1" }] : []), clock);
    await expect(repository.reportMessage(filing)).rejects.toMatchObject({ code: "SELF_REPORT_FORBIDDEN", status: 422 });
  });

  it("derives the subject, excerpt and sent-at from the message row, never from the reporter", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresGovernanceInboxRepository(fakeSql((query) =>
      query.includes("INSERT INTO room.reports") ? [{ reportId: "report-message", status: "OPEN" }] : [], log), clock);
    await expect(repository.reportMessage({ ...filing, reporterUserId: "member-1" }))
      .resolves.toMatchObject({ status: "OPEN" });
    const insert = log.queries.find((query) => query.includes("INSERT INTO room.reports"))!;
    // Subject account, excerpt snapshot and timestamp all come off the joined
    // message row inside the statement (deferred-work gap ①) — the caller has
    // no parameter to fabricate any of them through.
    expect(insert).toContain("msg.user_id,left(msg.body,2000),msg.created_at");
    expect(insert).toContain("JOIN room.members m ON m.room_id = r.id");
    expect(insert).toContain("JOIN room.messages msg ON msg.room_id = r.id");
    expect(insert).toContain("msg.user_id <> ");
    expect(log.values.some((value) => value instanceof Date)).toBe(false);
  });
});

describe("channel reports (Story 12.4)", () => {
  const CHANNEL_REPORT = { ...ROOM_REPORT, reportId: "report-channel", kind: "CHANNEL_MESSAGE", subject: "阿强" };
  const CHANNEL_TARGET = {
    reportId: "report-channel", kind: "CHANNEL_MESSAGE", status: "OPEN", reporterUserId: "member-1", assignedTo: null,
    roomId: null, roomName: null, roomStatus: null, roomOwnerId: null,
    messageId: null, channelMessageId: "channel-message-1", subjectUserId: "author-1",
  };

  it("shows a moderator the reported channel message under the explicit scope label — never a NULL room name", async () => {
    const repository = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, {
      report: CHANNEL_REPORT,
      extra: (query) => query.includes('rp.channel_message_id AS "messageId"')
        ? [{ messageId: "channel-message-1", author: "阿强", body: "被举报的频道发言", sentAt: "2026-07-29T09:59:00.000Z", hidden: false, mutedUntil: null }]
        : [],
    })), clock);
    const detail = await repository.getReport("mod-1", "report-channel");
    expect(detail.room).toBeNull();
    expect(detail.message).toMatchObject({ messageId: "channel-message-1", roomName: "PULSE CLUB", author: "阿强" });
    expect(detail.availableDispositions).toEqual(["HIDE_MESSAGE", "RESTORE_MESSAGE", "MUTE_MEMBER", "DISMISS"]);
    expect(() => assertMinimalReportContext(detail)).not.toThrow();

    // An operations-admin has no community duty: the channel report does not exist for them.
    const opsAdmin = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_OPS_ADMIN, { report: CHANNEL_REPORT })), clock);
    await expect(opsAdmin.getReport("ops-1", "report-channel")).rejects.toMatchObject({ code: "REPORT_NOT_FOUND", status: 404 });
  });

  it("hides and restores a channel message in the club tables, with the shared audit vocabulary", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const hide = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, { target: CHANNEL_TARGET }), log), clock);
    await expect(hide.resolveReport("mod-1", "report-channel", { disposition: "HIDE_MESSAGE", reason: "违规导流" }))
      .resolves.toMatchObject({ status: "RESOLVED", notifiedUsers: 2 });
    const hidden = log.queries.find((query) => query.includes("INSERT INTO club.channel_message_moderation"))!;
    expect(hidden).toContain("ON CONFLICT (message_id) DO UPDATE");
    expect(log.queries.some((query) => query.includes("INSERT INTO room.message_moderation"))).toBe(false);
    // Zero new audit actions: the channel reuses MESSAGE_HIDDEN, filed under the author.
    expect(log.values).toContain("MESSAGE_HIDDEN");
    expect(log.values).toContain("author-1");
    expect(log.values).toContain("channel-message-1");

    const restoreLog = { queries: [] as string[], values: [] as unknown[] };
    const restore = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, {
      target: CHANNEL_TARGET,
      extra: (query) => query.includes("UPDATE club.channel_message_moderation") ? [{ messageId: "channel-message-1" }] : [],
    }), restoreLog), clock);
    await expect(restore.resolveReport("mod-1", "report-channel", { disposition: "RESTORE_MESSAGE", reason: "复核后恢复" }))
      .resolves.toMatchObject({ status: "RESOLVED" });
    expect(restoreLog.values).toContain("MESSAGE_RESTORED");
  });

  it("mutes the author community-wide: the club mute table, keyed on the user alone, expired windows settled first", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, { target: CHANNEL_TARGET }), log), clock);
    await expect(repository.resolveReport("mod-1", "report-channel", { disposition: "MUTE_MEMBER", reason: "连续辱骂", muteHours: 24 }))
      .resolves.toMatchObject({ status: "RESOLVED", notifiedUsers: 2 });
    const sweep = log.queries.findIndex((query) => query.includes("UPDATE club.channel_mutes SET lifted_at = muted_until"));
    const insert = log.queries.findIndex((query) => query.includes("INSERT INTO club.channel_mutes"));
    expect(sweep).toBeGreaterThanOrEqual(0);
    expect(sweep).toBeLessThan(insert);
    expect(log.queries[insert]).not.toContain("room_id");
    expect(log.queries.some((query) => query.includes("room.member_mutes"))).toBe(false);
    expect(log.values).toContain("MEMBER_MUTED");
    expect(log.values).toContain("2026-07-31T10:00:00.000Z");
  });

  it("refuses a room disposition against a channel report", async () => {
    const repository = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, { target: CHANNEL_TARGET })), clock);
    await expect(repository.resolveReport("mod-1", "report-channel", { disposition: "CLOSE_ROOM", reason: "越权尝试" }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST", status: 422 });
  });

  it("lifts a community mute from the club table", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresGovernanceInboxRepository(fakeSql(responder(AS_MODERATOR, {
      target: CHANNEL_TARGET,
      extra: (query) => query.includes("UPDATE club.channel_mutes SET lifted_by") ? [{ userId: "author-1" }] : [],
    }), log), clock);
    await expect(repository.liftMute("mod-1", "report-channel", "复核后解除禁言")).resolves.toMatchObject({ lifted: true });
    expect(log.queries.some((query) => query.includes("UPDATE room.member_mutes"))).toBe(false);
  });
});

describe("filing a channel message report", () => {
  const filing = { messageId: "channel-message-1", reporterUserId: "member-9", reason: "违规导流拉人" };

  it("requires a confirmed copy of the current community rules before anything else", async () => {
    const repository = new PostgresGovernanceInboxRepository(fakeSql(() => []), clock);
    await expect(repository.reportChannelMessage(filing)).rejects.toMatchObject({ code: "RULES_CONFIRMATION_REQUIRED", status: 403 });
  });

  it("names a self-report, a duplicate filing, and a missing message — in recovery order", async () => {
    const confirmed = (extra: Respond): Respond => (query) => {
      if (query.includes("INSERT INTO room.reports")) return [];
      if (query.includes("identity.rule_acceptances")) return [{ present: 1 }];
      return extra(query);
    };
    const self = new PostgresGovernanceInboxRepository(fakeSql(confirmed((query) =>
      query.includes("SELECT id FROM club.channel_messages") ? [{ id: "channel-message-1" }] : [])), clock);
    await expect(self.reportChannelMessage(filing)).rejects.toMatchObject({ code: "SELF_REPORT_FORBIDDEN", status: 422 });

    const duplicate = new PostgresGovernanceInboxRepository(fakeSql(confirmed((query) =>
      query.includes("SELECT id FROM room.reports") ? [{ id: "report-channel" }] : [])), clock);
    await expect(duplicate.reportChannelMessage(filing)).rejects.toMatchObject({ code: "REPORT_ALREADY_OPEN", status: 409 });

    const missing = new PostgresGovernanceInboxRepository(fakeSql(confirmed(() => [])), clock);
    await expect(missing.reportChannelMessage(filing)).rejects.toMatchObject({ code: "MESSAGE_NOT_FOUND", status: 404 });
  });

  it("derives subject, excerpt and sent-at from the channel message row, with no room anywhere", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresGovernanceInboxRepository(fakeSql((query) =>
      query.includes("INSERT INTO room.reports") ? [{ reportId: "report-channel", status: "OPEN" }] : [], log), clock);
    await expect(repository.reportChannelMessage(filing)).resolves.toMatchObject({ status: "OPEN" });
    const insert = log.queries.find((query) => query.includes("INSERT INTO room.reports"))!;
    expect(insert).toContain("'CHANNEL_MESSAGE'");
    expect(insert).toContain("msg.user_id,left(msg.body,2000),msg.created_at");
    expect(insert).toContain("FROM club.channel_messages msg");
    expect(insert).toContain("identity.rule_acceptances");
    expect(insert).not.toContain("room.members");
    // room_id travels as an explicit NULL — the three-branch CHECK insists on it.
    expect(insert).toContain(",NULL,'CHANNEL_MESSAGE'");
  });
});

describe("an affected member's own notices", () => {
  it("reads and closes them without any operator duty", async () => {
    const repository = new PostgresGovernanceInboxRepository(fakeSql((query) =>
      query.includes("SELECT id, kind, reason") ? [{ id: "notice-1", kind: "MEMBER_MUTED", reason: "连续辱骂", createdAt: "2026-07-30T09:00:00.000Z", readAt: null }] : []), clock);
    await expect(repository.listNotices("author-1")).resolves.toEqual([
      { id: "notice-1", kind: "MEMBER_MUTED", reason: "连续辱骂", createdAt: "2026-07-30T09:00:00.000Z", readAt: null },
    ]);
    await expect(repository.markNoticeRead("author-1", "notice-1")).rejects.toMatchObject({ code: "NOTICE_NOT_FOUND", status: 404 });
  });

  it("scopes every notice read to the holder", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const repository = new PostgresGovernanceInboxRepository(fakeSql(() => [], log), clock);
    await repository.listNotices("author-1");
    await repository.markNoticeRead("author-1", "notice-1").catch(() => {});
    for (const query of log.queries) expect(query).toContain("user_id = $");
    expect(OperationError).toBeTruthy();
  });
});
