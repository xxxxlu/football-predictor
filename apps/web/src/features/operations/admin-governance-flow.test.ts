import { describe, expect, it, vi } from "vitest";
import {
  applyDisposition,
  buildInboxQuery,
  DEFAULT_INBOX_FILTERS,
  dispositionLabel,
  governanceActionLabel,
  liftMute,
  loadInbox,
  loadReportDetail,
  requiresMuteDuration,
  triageReport,
} from "./admin-governance-flow";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (data: unknown) => json({ data });

const REPORT = {
  reportId: "report-1", kind: "MESSAGE", severity: "HIGH", status: "OPEN", reason: "人身攻击",
  reporter: "阿明", assignee: null, assignedToMe: false, subject: "阿强",
  createdAt: "2026-07-29T10:00:00.000Z", updatedAt: "2026-07-29T10:00:00.000Z",
};

describe("inbox filters", () => {
  it("keeps the default view's URL clean and serializes only real narrowing", () => {
    expect(buildInboxQuery(DEFAULT_INBOX_FILTERS)).toBe("");
    expect(buildInboxQuery({ kind: "MESSAGE", status: "ALL", severity: "HIGH", assignee: "ME" }))
      .toBe("kind=MESSAGE&status=ALL&severity=HIGH&assignee=ME");
  });

  it("asks the server for the queue and revives the timestamps", async () => {
    const fetcher = vi.fn<Fetcher>(async () => ok({ actorId: "mod-1", reports: [REPORT] }));
    const { actorId, reports } = await loadInbox(fetcher, { ...DEFAULT_INBOX_FILTERS, assignee: "ME" });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/admin/governance/reports?assignee=ME", { credentials: "same-origin", cache: "no-store" });
    expect(actorId).toBe("mod-1");
    expect(reports[0]).toMatchObject({ reportId: "report-1", kind: "MESSAGE", severity: "HIGH" });
    expect(reports[0]!.createdAt).toEqual(new Date("2026-07-29T10:00:00.000Z"));
  });

  it("surfaces the server's own refusal rather than inventing one", async () => {
    const fetcher = vi.fn<Fetcher>(async () => json({ error: { code: "FORBIDDEN", message: "You do not have permission for this operation." } }, 403));
    await expect(loadInbox(fetcher)).rejects.toThrow("You do not have permission for this operation.");
  });
});

describe("report detail", () => {
  it("revives the reported message and the report's own timeline", async () => {
    const fetcher = vi.fn<Fetcher>(async () => ok({
      ...REPORT,
      room: null,
      message: { messageId: "message-1", roomName: "周末德甲", author: "阿强", body: "被举报的原话", sentAt: "2026-07-29T09:59:00.000Z", hidden: false, mutedUntil: null },
      history: [{ id: "audit-1", action: "MESSAGE_REPORTED", actor: "阿明", result: "SUCCESS", metadata: {}, occurredAt: "2026-07-29T10:00:00.000Z" }],
      availableDispositions: ["HIDE_MESSAGE", "RESTORE_MESSAGE", "MUTE_MEMBER", "DISMISS"],
    }));
    const detail = await loadReportDetail(fetcher, "report-1");
    expect(detail.room).toBeNull();
    expect(detail.message).toMatchObject({ author: "阿强", body: "被举报的原话", hidden: false });
    expect(detail.message!.sentAt).toEqual(new Date("2026-07-29T09:59:00.000Z"));
    expect(detail.history[0]!.occurredAt).toEqual(new Date("2026-07-29T10:00:00.000Z"));
    expect(detail.availableDispositions).toHaveLength(4);
    expect(governanceActionLabel("MESSAGE_REPORTED")).toBe("提交消息举报");
    expect(governanceActionLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("triage", () => {
  it("claims a report without a password or a reason", async () => {
    const fetcher = vi.fn<Fetcher>(async () => ok({ reportId: "report-1", status: "ASSIGNED", severity: "HIGH" }));
    await expect(triageReport(fetcher, { reportId: "report-1", assign: "ME", severity: "HIGH" })).resolves.toMatchObject({ status: "ASSIGNED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, init] = fetcher.mock.calls[0]!;
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ assign: "ME", severity: "HIGH" });
  });
});

describe("dispositions", () => {
  it("refuses a short or overlong reason before contacting the server at all", async () => {
    const fetcher = vi.fn<Fetcher>(async () => ok({}));
    for (const reason of ["短", "x".repeat(501)]) {
      await expect(applyDisposition(fetcher, { reportId: "report-1", disposition: "DISMISS", reason, password: "pw" })).rejects.toThrow(/5-500/);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires a duration for a mute, since an open-ended silence is not on offer", async () => {
    const fetcher = vi.fn<Fetcher>(async () => ok({}));
    await expect(applyDisposition(fetcher, { reportId: "report-1", disposition: "MUTE_MEMBER", reason: "连续辱骂其他成员", password: "pw" })).rejects.toThrow("请选择禁言时长");
    expect(fetcher).not.toHaveBeenCalled();
    expect(requiresMuteDuration("MUTE_MEMBER")).toBe(true);
    expect(requiresMuteDuration("DISMISS")).toBe(false);
  });

  it("confirms the operator's password first, then sends the trimmed decision", async () => {
    const fetcher = vi.fn<Fetcher>(async (input) =>
      String(input).includes("reauthenticate") ? ok({ expiresAt: "2026-07-30T10:05:00.000Z" }) : ok({ reportId: "report-1", status: "RESOLVED", disposition: "MUTE_MEMBER", notifiedUsers: 2, auditId: "audit-9" }));
    const result = await applyDisposition(fetcher, { reportId: "report-1", disposition: "MUTE_MEMBER", reason: "  连续辱骂其他成员  ", muteHours: 24, password: "pw" });
    expect(result).toMatchObject({ status: "RESOLVED", notifiedUsers: 2, auditId: "audit-9" });
    expect(fetcher.mock.calls[0]![0]).toBe("/api/v1/auth/reauthenticate");
    expect(fetcher.mock.calls[1]![0]).toBe("/api/v1/admin/governance/reports/report-1/resolution");
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body))).toEqual({ disposition: "MUTE_MEMBER", reason: "连续辱骂其他成员", muteHours: 24 });
  });

  it("stops at a failed password confirmation without sending the decision", async () => {
    const fetcher = vi.fn<Fetcher>(async (input) =>
      String(input).includes("reauthenticate") ? json({ error: { code: "INVALID_CREDENTIALS", message: "密码不正确。" } }, 401) : ok({}));
    await expect(applyDisposition(fetcher, { reportId: "report-1", disposition: "CLOSE_ROOM", reason: "反复违规拉人", password: "wrong" })).rejects.toThrow("密码不正确。");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports a conflict from the server in the server's words", async () => {
    const fetcher = vi.fn<Fetcher>(async (input) =>
      String(input).includes("reauthenticate") ? ok({}) : json({ error: { code: "REPORT_ALREADY_CLOSED", message: "That report has already been decided." } }, 409));
    await expect(applyDisposition(fetcher, { reportId: "report-1", disposition: "DISMISS", reason: "无需处理，予以驳回", password: "pw" }))
      .rejects.toThrow("That report has already been decided.");
  });

  it("lifts a mute through the same reason-and-password path", async () => {
    const fetcher = vi.fn<Fetcher>(async (input) =>
      String(input).includes("reauthenticate") ? ok({}) : ok({ reportId: "report-1", lifted: true, auditId: "audit-10" }));
    await expect(liftMute(fetcher, { reportId: "report-1", reason: "复核后解除禁言", password: "pw" })).resolves.toMatchObject({ lifted: true });
    expect(fetcher.mock.calls[1]![0]).toBe("/api/v1/admin/governance/reports/report-1/mute-lift");
    expect(dispositionLabel("MUTE_MEMBER")).toBe("临时禁言");
  });
});
