/**
 * Browser side of the unified operations overview and permission audit
 * (FR58, FR60, FR81, FR90).
 *
 * The server decides what an operator may see: the overview returns only the
 * cards their duties cover, and the audit trail is refused outright without
 * AUDIT_READ. What this module adds is honesty about what the console asks for —
 * validated filters, a written reason plus a password on the one write, and the
 * server's own refusal message when a request is denied.
 *
 * The only write here is a task retry, and it names a job id and a reason. There
 * is deliberately no way to hand the server a payload, an odds version or a
 * settlement target from this screen.
 */
export type Severity = "OK" | "WATCH" | "ACT";
export type OverviewCard = "SUPPLIER_HEALTH" | "SETTLEMENT_HEALTH" | "JOB_HEALTH" | "REPORT_QUEUE" | "ACCOUNT_RISK" | "ROLE_CHANGES" | "HIGH_RISK_ACTIONS";
export type OverviewMetric = { key: string; label: string; value: number };
export type OverviewSection = {
  card: OverviewCard; severity: Severity; metrics: OverviewMetric[]; detail: string | null;
  nextStep: { label: string; href: string; capability: string } | null;
};
export type OperationsOverview = { generatedAt: Date; overall: Severity; capabilities: string[]; sections: OverviewSection[] };
export type FailedJob = { id: string; kind: string; attempt: number; runCount: number; lastErrorCode: string | null; availableAt: Date; updatedAt: Date };
export type AuditEvent = { id: string; actor: string | null; action: string; targetType: string; targetId: string; result: string; metadata: unknown; occurredAt: Date };

export type AuditGroup = "ALL" | "ROLE" | "ACCOUNT" | "PRIVACY" | "ROOM" | "COMMUNITY" | "TASK" | "LIFECYCLE";
export type AuditTargetType = "ALL" | "USER" | "ROOM" | "REPORT" | "JOB";
export type AuditResult = "ALL" | "SUCCESS" | "FAILURE";
export type AuditFilters = {
  actor: string; group: AuditGroup; action: string; targetType: AuditTargetType; targetId: string;
  result: AuditResult; from: string; to: string; correlationId: string;
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Failure = { error?: { message?: string } };

export const DEFAULT_AUDIT_FILTERS: AuditFilters = {
  actor: "", group: "ALL", action: "", targetType: "ALL", targetId: "", result: "ALL", from: "", to: "", correlationId: "",
};
export const MIN_REASON_LENGTH = 5;
export const MAX_REASON_LENGTH = 500;

export const SEVERITY_LABELS: Record<Severity, string> = { OK: "● 正常", WATCH: "▲ 需关注", ACT: "■ 待处理" };
export const CARD_LABELS: Record<OverviewCard, string> = {
  SUPPLIER_HEALTH: "供应商额度与缓存", SETTLEMENT_HEALTH: "结算健康", JOB_HEALTH: "后台任务",
  REPORT_QUEUE: "治理收件箱", ACCOUNT_RISK: "账户与生命周期", ROLE_CHANGES: "运营职责", HIGH_RISK_ACTIONS: "高风险操作",
};
export const GROUP_LABELS: Record<AuditGroup, string> = {
  ALL: "全部动作", ROLE: "运营职责", ACCOUNT: "账户安全", PRIVACY: "隐私与生命周期",
  ROOM: "房间治理", COMMUNITY: "社区治理", TASK: "运营任务", LIFECYCLE: "房间生命周期",
};
export const TARGET_LABELS: Record<AuditTargetType, string> = { ALL: "全部对象", USER: "账户", ROOM: "房间", REPORT: "举报", JOB: "任务" };
export const RESULT_LABELS: Record<AuditResult, string> = { ALL: "全部结果", SUCCESS: "成功", FAILURE: "失败" };

/** Chinese labels for every action the merged trail can contain. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  OPERATOR_ROLE_GRANTED: "授予运营职责", OPERATOR_ROLE_REVOKED: "撤销运营职责",
  ACCOUNT_DISABLED: "禁用账户", ACCOUNT_RESTORED: "恢复账户", SESSIONS_REVOKED: "撤销全部会话",
  ACCOUNT_ANONYMIZATION_REQUESTED: "提交匿名化申请", ACCOUNT_ANONYMIZED: "已匿名化账户",
  ROOM_RESTRICT: "限制房间", ROOM_CLOSE: "关闭房间", ROOM_RESTORE: "恢复房间",
  ROOM_PRE_MATCH_STAKE_VISIBILITY_UPDATED: "调整投入可见性", INVITE_RESET: "重置邀请码",
  ROOM_REPORTED: "提交房间举报", MESSAGE_REPORTED: "提交消息举报", REPORT_TRIAGED: "认领 / 调整严重度",
  REPORT_RESOLVED: "已处置举报", REPORT_DISMISSED: "已驳回举报", MEMBER_UNMUTED: "解除禁言",
  JOB_RETRY_REQUESTED: "重新排队任务", ROOM_CREATED: "创建房间", ROOM_JOINED: "加入房间",
};

export function auditActionLabel(action: string) { return AUDIT_ACTION_LABELS[action] ?? action; }
export function severityLabel(severity: Severity) { return SEVERITY_LABELS[severity] ?? severity; }
export function cardLabel(card: OverviewCard) { return CARD_LABELS[card] ?? card; }

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Serializes only the filters that actually narrow the trail, so the default view
 * has a clean URL.
 *
 * A `<input type="date">` yields a bare day. Sent as-is it would mean midnight, so
 * an operator asking for "up to the 30th" would silently lose that whole day. The
 * day is widened to its own boundaries **in the operator's timezone**, because the
 * timestamps on screen are rendered in that timezone too: a UTC+8 reviewer picking
 * the 30th means their 30th, not 08:00 on the 30th through 08:00 on the 31st. The
 * upper bound is the start of the following day and the server treats it as
 * exclusive, so the whole picked day is covered to the microsecond.
 */
export function buildAuditQuery(filters: AuditFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    const current = String(value).trim();
    if (current === "" || current === "ALL") continue;
    if (DATE_ONLY.test(current) && (key === "from" || key === "to")) {
      params.set(key, localDayBoundary(current, key === "to").toISOString());
      continue;
    }
    params.set(key, current);
  }
  return params.toString();
}

/** Local midnight of a bare `YYYY-MM-DD`, or of the day after it for an end bound. */
function localDayBoundary(day: string, next: boolean): Date {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, date + (next ? 1 : 0), 0, 0, 0, 0);
}

export async function loadOverview(fetcher: Fetcher = fetch): Promise<OperationsOverview> {
  const data = await read<{ generatedAt: string; overall: Severity; capabilities?: string[]; sections?: OverviewSection[] }>(fetcher, "/api/v1/admin/overview", "无法加载运营总览");
  return {
    generatedAt: new Date(data.generatedAt), overall: data.overall,
    capabilities: data.capabilities ?? [], sections: data.sections ?? [],
  };
}

export async function loadFailedJobs(fetcher: Fetcher = fetch): Promise<FailedJob[]> {
  const data = await read<{ jobs?: Array<Record<string, unknown>> }>(fetcher, "/api/v1/admin/jobs", "无法加载失败任务");
  return (data.jobs ?? []).map((row) => ({
    id: String(row.id), kind: String(row.kind ?? ""), attempt: Number(row.attempt ?? 0), runCount: Number(row.runCount ?? 0),
    lastErrorCode: (row.lastErrorCode as string | null) ?? null,
    availableAt: new Date(String(row.availableAt)), updatedAt: new Date(String(row.updatedAt)),
  }));
}

export async function loadAudit(fetcher: Fetcher = fetch, filters: AuditFilters = DEFAULT_AUDIT_FILTERS): Promise<AuditEvent[]> {
  const query = buildAuditQuery(filters);
  const data = await read<{ events?: Array<Record<string, unknown>> }>(fetcher, `/api/v1/admin/audit${query ? `?${query}` : ""}`, "无法加载审计记录");
  return (data.events ?? []).map((row) => ({
    id: String(row.id), actor: (row.actor as string | null) ?? null, action: String(row.action ?? ""),
    targetType: String(row.targetType ?? ""), targetId: String(row.targetId ?? ""), result: String(row.result ?? ""),
    metadata: row.metadata ?? {}, occurredAt: new Date(String(row.occurredAt)),
  }));
}

/**
 * FR58 safe retry. Requires the operator's own password because the server will
 * not accept the write without a fresh proof — the pairing is a requirement, not
 * a convenience. The request carries a job id and a reason and nothing else.
 */
export async function retryJob(fetcher: Fetcher = fetch, input: { jobId: string; reason: string; password: string }) {
  const reason = input.reason.trim();
  if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) {
    throw new Error(`请填写 ${MIN_REASON_LENGTH}-${MAX_REASON_LENGTH} 字的重试理由`);
  }
  const reauth = await fetcher("/api/v1/auth/reauthenticate", {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: input.password }),
  });
  const reauthBody = await reauth.json().catch(() => ({})) as Failure;
  if (!reauth.ok) throw new Error(reauthBody.error?.message || "管理员身份确认失败");

  const response = await fetcher(`/api/v1/admin/jobs/${encodeURIComponent(input.jobId)}/retry`, {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  const result = await response.json().catch(() => ({})) as Failure & { data?: { jobId: string; status: string; availableAt: string; auditId: string } };
  if (!response.ok || result.data === undefined) throw new Error(result.error?.message || "重试失败");
  return result.data;
}

/**
 * A failed read, carrying the status so the console can tell "this duty is not
 * yours" apart from "this request did not get through". Rendering the second as
 * the first would tell an operator they lack a permission they actually hold.
 */
export class OverviewRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "OverviewRequestError";
  }
}

/** A refusal about permission — as opposed to a transport or server failure. */
export function isRefusal(error: unknown): boolean {
  return error instanceof OverviewRequestError && (error.status === 401 || error.status === 403);
}

async function read<T>(fetcher: Fetcher, path: string, failure: string): Promise<T> {
  const response = await fetcher(path, { credentials: "same-origin", cache: "no-store" });
  const result = await response.json().catch(() => ({})) as Failure & { data?: T };
  if (!response.ok || result.data === undefined) {
    throw new OverviewRequestError(result.error?.message || failure, response.status);
  }
  return result.data;
}
