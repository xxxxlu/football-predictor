/**
 * Browser side of the room and community governance inbox (FR81, FR83, FR90).
 *
 * The server is the security boundary: the queue is narrowed by capability
 * server-side and every disposition needs a duty, a fresh re-auth proof and a
 * written reason. What this module adds is honesty about what the console asks
 * for — validated filters, a justification on every disposition, and the
 * server's own refusal message when a request is denied.
 *
 * A disposition names a report and nothing else. There is deliberately no way to
 * address a room, a message or a member directly from here.
 */
export type ReportKind = "ROOM" | "MESSAGE" | "CHANNEL_MESSAGE";
export type ReportSeverity = "LOW" | "NORMAL" | "HIGH";
export type ReportStatus = "OPEN" | "ASSIGNED" | "RESOLVED" | "DISMISSED";
export type ReportDisposition = "RESTRICT_ROOM" | "CLOSE_ROOM" | "RESTORE_ROOM" | "HIDE_MESSAGE" | "RESTORE_MESSAGE" | "MUTE_MEMBER" | "DISMISS";
export type MuteHours = 1 | 24 | 72 | 168;

export type InboxFilters = {
  kind: "ALL" | ReportKind;
  status: "PENDING" | "ALL" | ReportStatus;
  severity: "ALL" | ReportSeverity;
  assignee: "ALL" | "ME" | "UNASSIGNED" | "OTHERS";
};

export type QueuedReport = {
  reportId: string; kind: ReportKind; severity: ReportSeverity; status: ReportStatus; reason: string;
  reporter: string; assignee: string | null; assignedToMe: boolean; subject: string;
  createdAt: Date; updatedAt: Date;
};
export type RoomContext = { roomId: string; roomName: string; roomStatus: string; memberCount: number; openReportCount: number };
export type MessageContext = { messageId: string; roomName: string; author: string; body: string; sentAt: Date; hidden: boolean; mutedUntil: Date | null };
export type HistoryEntry = { id: string; action: string; actor: string | null; result: string; metadata: unknown; occurredAt: Date };
export type ReportDetail = QueuedReport & {
  room: RoomContext | null;
  message: MessageContext | null;
  history: HistoryEntry[];
  availableDispositions: ReportDisposition[];
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Failure = { error?: { message?: string } };

export const DEFAULT_INBOX_FILTERS: InboxFilters = { kind: "ALL", status: "PENDING", severity: "ALL", assignee: "ALL" };
export const MIN_REASON_LENGTH = 5;
export const MAX_REASON_LENGTH = 500;
export const MUTE_HOUR_OPTIONS: readonly MuteHours[] = [1, 24, 72, 168];

export const KIND_FILTER_LABELS: Record<InboxFilters["kind"], string> = { ALL: "全部举报", ROOM: "房间举报", MESSAGE: "消息举报", CHANNEL_MESSAGE: "频道举报" };
export const STATUS_FILTER_LABELS: Record<InboxFilters["status"], string> = {
  PENDING: "待处理", ALL: "全部状态", OPEN: "未认领", ASSIGNED: "已认领", RESOLVED: "已处置", DISMISSED: "已驳回",
};
export const SEVERITY_FILTER_LABELS: Record<InboxFilters["severity"], string> = { ALL: "全部严重度", HIGH: "高", NORMAL: "中", LOW: "低" };
export const ASSIGNEE_FILTER_LABELS: Record<InboxFilters["assignee"], string> = { ALL: "全部处理人", ME: "我认领的", UNASSIGNED: "无人认领", OTHERS: "他人认领" };
export const SEVERITY_LABELS: Record<ReportSeverity, string> = { HIGH: "高", NORMAL: "中", LOW: "低" };
export const STATUS_LABELS: Record<ReportStatus, string> = { OPEN: "未认领", ASSIGNED: "已认领", RESOLVED: "已处置", DISMISSED: "已驳回" };
export const KIND_LABELS: Record<ReportKind, string> = { ROOM: "房间举报", MESSAGE: "消息举报", CHANNEL_MESSAGE: "频道举报" };
export const MUTE_LABELS: Record<MuteHours, string> = { 1: "1 小时", 24: "24 小时", 72: "3 天", 168: "7 天" };

/** What each disposition is called, and the verb the confirmation button uses. */
export const DISPOSITION_LABELS: Record<ReportDisposition, string> = {
  RESTRICT_ROOM: "限制房间预测", CLOSE_ROOM: "关闭房间", RESTORE_ROOM: "恢复房间",
  HIDE_MESSAGE: "隐藏消息", RESTORE_MESSAGE: "恢复消息", MUTE_MEMBER: "临时禁言", DISMISS: "驳回举报",
};

/** Chinese labels for the audit actions a report's own timeline can contain. */
export const GOVERNANCE_ACTION_LABELS: Record<string, string> = {
  ROOM_REPORTED: "提交房间举报", MESSAGE_REPORTED: "提交消息举报", REPORT_TRIAGED: "认领 / 调整严重度",
  REPORT_RESOLVED: "已处置", REPORT_DISMISSED: "已驳回", MEMBER_UNMUTED: "解除禁言",
  ROOM_RESTRICT: "限制房间", ROOM_CLOSE: "关闭房间", ROOM_RESTORE: "恢复房间",
  ROOM_PRE_MATCH_STAKE_VISIBILITY_UPDATED: "调整投入可见性",
};

export function severityLabel(severity: ReportSeverity) { return SEVERITY_LABELS[severity] ?? severity; }
export function dispositionLabel(disposition: ReportDisposition) { return DISPOSITION_LABELS[disposition] ?? disposition; }
export function governanceActionLabel(action: string) { return GOVERNANCE_ACTION_LABELS[action] ?? action; }
export function requiresMuteDuration(disposition: ReportDisposition) { return disposition === "MUTE_MEMBER"; }

/** Serializes only the filters that actually narrow the queue, so the default view has a clean URL. */
export function buildInboxQuery(filters: InboxFilters): string {
  const params = new URLSearchParams();
  if (filters.kind !== "ALL") params.set("kind", filters.kind);
  if (filters.status !== "PENDING") params.set("status", filters.status);
  if (filters.severity !== "ALL") params.set("severity", filters.severity);
  if (filters.assignee !== "ALL") params.set("assignee", filters.assignee);
  return params.toString();
}

export async function loadInbox(fetcher: Fetcher = fetch, filters: InboxFilters = DEFAULT_INBOX_FILTERS): Promise<{ actorId: string; reports: QueuedReport[] }> {
  const query = buildInboxQuery(filters);
  const data = await read<{ actorId?: string; reports?: unknown[] }>(fetcher, `/api/v1/admin/governance/reports${query ? `?${query}` : ""}`, "无法加载治理收件箱");
  return { actorId: String(data.actorId ?? ""), reports: (data.reports ?? []).map(reviveReport) };
}

export async function loadReportDetail(fetcher: Fetcher = fetch, reportId: string): Promise<ReportDetail> {
  const data = await read<Record<string, unknown>>(fetcher, `/api/v1/admin/governance/reports/${encodeURIComponent(reportId)}`, "无法加载举报详情");
  return {
    ...reviveReport(data),
    room: (data.room as RoomContext | null) ?? null,
    message: data.message ? reviveMessage(data.message as Record<string, unknown>) : null,
    history: ((data.history as Array<Record<string, unknown>>) ?? []).map((entry) => ({
      id: String(entry.id), action: String(entry.action), actor: (entry.actor as string | null) ?? null,
      result: String(entry.result), metadata: entry.metadata, occurredAt: new Date(String(entry.occurredAt)),
    })),
    availableDispositions: (data.availableDispositions as ReportDisposition[]) ?? [],
  };
}

/** Triage carries no reason and no password: nothing a member can see changes. */
export async function triageReport(fetcher: Fetcher = fetch, input: { reportId: string; assign?: "ME" | "NONE"; severity?: ReportSeverity }) {
  const body: Record<string, unknown> = {};
  if (input.assign) body.assign = input.assign;
  if (input.severity) body.severity = input.severity;
  const response = await fetcher(`/api/v1/admin/governance/reports/${encodeURIComponent(input.reportId)}/triage`, {
    method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as Failure & { data?: { reportId: string; status: ReportStatus; severity: ReportSeverity } };
  if (!response.ok || result.data === undefined) throw new Error(result.error?.message || "认领失败");
  return result.data;
}

export async function applyDisposition(fetcher: Fetcher = fetch, input: { reportId: string; disposition: ReportDisposition; reason: string; muteHours?: MuteHours; password: string }) {
  if (requiresMuteDuration(input.disposition) && !input.muteHours) throw new Error("请选择禁言时长");
  return write<{ reportId: string; status: ReportStatus; disposition: ReportDisposition; notifiedUsers: number; auditId: string }>(fetcher, {
    path: `/api/v1/admin/governance/reports/${encodeURIComponent(input.reportId)}/resolution`, method: "POST",
    body: { disposition: input.disposition, reason: input.reason.trim(), ...(input.muteHours ? { muteHours: input.muteHours } : {}) },
    reason: input.reason, password: input.password, failure: "处置失败",
  });
}

export async function liftMute(fetcher: Fetcher = fetch, input: { reportId: string; reason: string; password: string }) {
  return write<{ reportId: string; lifted: true; auditId: string }>(fetcher, {
    path: `/api/v1/admin/governance/reports/${encodeURIComponent(input.reportId)}/mute-lift`, method: "POST",
    body: { reason: input.reason.trim() }, reason: input.reason, password: input.password, failure: "解除禁言失败",
  });
}

async function read<T>(fetcher: Fetcher, path: string, failure: string): Promise<T> {
  const response = await fetcher(path, { credentials: "same-origin", cache: "no-store" });
  const result = await response.json().catch(() => ({})) as Failure & { data?: T };
  if (!response.ok || result.data === undefined) throw new Error(result.error?.message || failure);
  return result.data;
}

/**
 * Every disposition follows the same shape: check the justification locally,
 * confirm the operator's own password, then send the decision. The proof is
 * scoped to /api/v1/admin and lasts five minutes; the server refuses the write
 * without it, so this pairing is a requirement rather than a convenience.
 */
async function write<T>(fetcher: Fetcher, input: { path: string; method: string; body: Record<string, unknown>; reason: string; password: string; failure: string }): Promise<T> {
  const reason = input.reason.trim();
  if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) {
    throw new Error(`请填写 ${MIN_REASON_LENGTH}-${MAX_REASON_LENGTH} 字的处置理由`);
  }
  const reauth = await fetcher("/api/v1/auth/reauthenticate", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: input.password }) });
  const reauthBody = await reauth.json().catch(() => ({})) as Failure;
  if (!reauth.ok) throw new Error(reauthBody.error?.message || "管理员身份确认失败");

  const response = await fetcher(input.path, { method: input.method, credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(input.body) });
  const result = await response.json().catch(() => ({})) as Failure & { data?: T };
  if (!response.ok || result.data === undefined) throw new Error(result.error?.message || input.failure);
  return result.data;
}

function reviveReport(raw: unknown): QueuedReport {
  const row = raw as Record<string, unknown>;
  return {
    reportId: String(row.reportId), kind: row.kind as ReportKind, severity: row.severity as ReportSeverity,
    status: row.status as ReportStatus, reason: String(row.reason ?? ""), reporter: String(row.reporter ?? ""),
    assignee: (row.assignee as string | null) ?? null, assignedToMe: Boolean(row.assignedToMe),
    subject: String(row.subject ?? ""), createdAt: new Date(String(row.createdAt)), updatedAt: new Date(String(row.updatedAt)),
  };
}

function reviveMessage(raw: Record<string, unknown>): MessageContext {
  return {
    messageId: String(raw.messageId), roomName: String(raw.roomName ?? ""), author: String(raw.author ?? ""),
    body: String(raw.body ?? ""), sentAt: new Date(String(raw.sentAt)), hidden: Boolean(raw.hidden),
    mutedUntil: raw.mutedUntil ? new Date(String(raw.mutedUntil)) : null,
  };
}
