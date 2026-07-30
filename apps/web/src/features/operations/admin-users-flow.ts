/**
 * Browser side of the user security and lifecycle console (FR81, FR82).
 *
 * The server is the security boundary: every read here is gated on
 * USER_SECURITY_READ and every write on USER_SECURITY_WRITE plus a fresh
 * re-auth proof. This module exists to keep the console honest about what it
 * asks for — a validated filter set, a justification on every write, and the
 * server's own refusal message when a request is denied.
 */
export type AccountStatus = "ACTIVE" | "DISABLED";
export type ActivityBucket = "ACTIVE_24H" | "ACTIVE_7D" | "ACTIVE_30D" | "DORMANT" | "NEVER";
export type StatusFilter = "ALL" | AccountStatus;
export type ActivityFilter = "ALL" | "LAST_24H" | "LAST_7D" | "LAST_30D" | "DORMANT_30D" | "NEVER";
export type RestrictionFilter = "ALL" | "COMMUNITY_RESTRICTED" | "UNRESTRICTED";

export type UserFilters = { search: string; status: StatusFilter; activity: ActivityFilter; restriction: RestrictionFilter; minRooms: number };

export type ManagedUser = {
  id: string; username: string; nickname: string | null; status: AccountStatus;
  lastSeenAt: Date | null; activityBucket: ActivityBucket; activeSessionCount: number;
  roomCount: number; ownedRoomCount: number; restrictedRoomCount: number;
  openReportCount: number; communityRestricted: boolean;
};
export type GovernanceEntry = { id: string; action: string; actor: string | null; result: string; metadata: unknown; occurredAt: Date };
export type AnonymizationSummary = { status: "RECEIVED" | "COMPLETED"; dueAt: Date; overdue: boolean; daysRemaining: number };
export type ManagedUserDetail = ManagedUser & { registeredAt: Date; operatorRoles: string[]; governanceHistory: GovernanceEntry[]; anonymization: AnonymizationSummary | null };
export type AnonymizationRequest = { id: string; userId: string; username: string; reason: string | null } & AnonymizationSummary;

export type AudienceDimension = { key: string; userCount: number };
export type AudienceStats = { totalUsers: number; locatedUsers: number; countries: AudienceDimension[]; regions: AudienceDimension[]; cities: AudienceDimension[]; deviceClasses: AudienceDimension[]; operatingSystems: AudienceDimension[]; browsers: AudienceDimension[] };

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Failure = { error?: { message?: string } };

export const DEFAULT_USER_FILTERS: UserFilters = { search: "", status: "ALL", activity: "ALL", restriction: "ALL", minRooms: 0 };
export const MIN_REASON_LENGTH = 5;
export const MAX_REASON_LENGTH = 500;

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = { ALL: "全部状态", ACTIVE: "已启用", DISABLED: "已禁用" };
export const ACTIVITY_FILTER_LABELS: Record<ActivityFilter, string> = {
  ALL: "全部活跃度", LAST_24H: "24 小时内", LAST_7D: "7 天内", LAST_30D: "30 天内", DORMANT_30D: "超过 30 天未登录", NEVER: "从未登录",
};
export const RESTRICTION_FILTER_LABELS: Record<RestrictionFilter, string> = { ALL: "全部", COMMUNITY_RESTRICTED: "名下房间被限制", UNRESTRICTED: "无限制记录" };
const ACTIVITY_LABELS: Record<ActivityBucket, string> = {
  ACTIVE_24H: "24 小时内活跃", ACTIVE_7D: "7 天内活跃", ACTIVE_30D: "30 天内活跃", DORMANT: "超过 30 天未登录", NEVER: "从未登录",
};
/** Chinese labels for the audit actions this console can produce or read back. */
export const ACTION_LABELS: Record<string, string> = {
  ACCOUNT_DISABLED: "禁用账户", ACCOUNT_RESTORED: "恢复账户", SESSIONS_REVOKED: "撤销全部会话",
  // The names the writers actually persist. `ROLE_GRANTED` / `ROOM_RESTRICTED` and
  // friends were never produced by anything, so those four rows fell through to
  // the raw enum on screen.
  OPERATOR_ROLE_GRANTED: "授予运营职责", OPERATOR_ROLE_REVOKED: "撤销运营职责",
  ACCOUNT_ANONYMIZATION_REQUESTED: "登记匿名化申请", ACCOUNT_ANONYMIZED: "已匿名化",
  ROOM_RESTRICT: "限制房间", ROOM_RESTORE: "解除房间限制", ROOM_CLOSE: "关闭房间",
  REPORT_RESOLVED: "处理举报", REPORT_DISMISSED: "驳回举报",
};

export function activityLabel(bucket: ActivityBucket) { return ACTIVITY_LABELS[bucket] ?? bucket; }
export function actionLabel(action: string) { return ACTION_LABELS[action] ?? action; }

/** Serializes only the filters that actually narrow the roster, so a default view has a clean URL. */
export function buildUserQuery(filters: UserFilters): string {
  const params = new URLSearchParams();
  const search = filters.search.trim();
  if (search) params.set("search", search);
  if (filters.status !== "ALL") params.set("status", filters.status);
  if (filters.activity !== "ALL") params.set("activity", filters.activity);
  if (filters.restriction !== "ALL") params.set("restriction", filters.restriction);
  if (filters.minRooms > 0) params.set("minRooms", String(filters.minRooms));
  return params.toString();
}

export async function loadAdminUsers(fetcher: Fetcher = fetch, filters: UserFilters = DEFAULT_USER_FILTERS): Promise<ManagedUser[]> {
  const query = buildUserQuery(filters);
  const data = await read<{ users?: unknown[] }>(fetcher, `/api/v1/admin/users${query ? `?${query}` : ""}`, "无法加载用户列表");
  return (data.users ?? []).map(reviveUser);
}

export async function loadUserDetail(fetcher: Fetcher = fetch, userId: string): Promise<ManagedUserDetail> {
  const data = await read<Record<string, unknown>>(fetcher, `/api/v1/admin/users/${encodeURIComponent(userId)}`, "无法加载账户概览");
  return {
    ...reviveUser(data),
    registeredAt: new Date(String(data.registeredAt)),
    operatorRoles: (data.operatorRoles as string[]) ?? [],
    governanceHistory: ((data.governanceHistory as Array<Record<string, unknown>>) ?? []).map((entry) => ({
      id: String(entry.id), action: String(entry.action), actor: (entry.actor as string | null) ?? null,
      result: String(entry.result), metadata: entry.metadata, occurredAt: new Date(String(entry.occurredAt)),
    })),
    anonymization: reviveLifecycle(data.anonymization as Record<string, unknown> | null),
  };
}

export async function loadAnonymizationQueue(fetcher: Fetcher = fetch): Promise<AnonymizationRequest[]> {
  const data = await read<{ requests?: Array<Record<string, unknown>> }>(fetcher, "/api/v1/admin/anonymization-requests", "无法加载匿名化申请");
  return (data.requests ?? []).flatMap((entry) => {
    // A row without a revivable deadline is dropped rather than spread from null:
    // `{...null}` is silently empty, which left `dueAt` undefined, and
    // `Intl.format(undefined)` renders today — a fabricated seven-day deadline on
    // the one screen whose purpose is to show when the real one falls.
    const lifecycle = reviveLifecycle(entry);
    if (!lifecycle) return [];
    return [{
      id: String(entry.id), userId: String(entry.userId), username: String(entry.username),
      reason: (entry.reason as string | null) ?? null, ...lifecycle,
    }];
  });
}

export async function loadAudienceStats(fetcher: Fetcher = fetch): Promise<AudienceStats> {
  return read<AudienceStats>(fetcher, "/api/v1/admin/audience", "无法加载用户画像");
}

export async function updateAdminUserStatus(fetcher: Fetcher = fetch, input: { userId: string; status: AccountStatus; reason: string; password: string }) {
  return write<{ targetUserId: string; status: AccountStatus; auditId: string }>(fetcher, {
    path: `/api/v1/admin/users/${encodeURIComponent(input.userId)}/status`, method: "PATCH",
    body: { status: input.status, reason: input.reason.trim() }, reason: input.reason, password: input.password, failure: "账户状态更新失败",
  });
}

export async function revokeUserSessions(fetcher: Fetcher = fetch, input: { userId: string; reason: string; password: string }) {
  return write<{ targetUserId: string; revokedSessions: number; auditId: string }>(fetcher, {
    path: `/api/v1/admin/users/${encodeURIComponent(input.userId)}/sessions`, method: "DELETE",
    body: { reason: input.reason.trim() }, reason: input.reason, password: input.password, failure: "会话撤销失败",
  });
}

export async function fileAnonymization(fetcher: Fetcher = fetch, input: { userId: string; reason: string; password: string }) {
  return write<{ targetUserId: string; privacyRequestId: string; status: "RECEIVED"; auditId: string }>(fetcher, {
    path: `/api/v1/admin/users/${encodeURIComponent(input.userId)}/anonymization-requests`, method: "POST",
    body: { reason: input.reason.trim() }, reason: input.reason, password: input.password, failure: "匿名化申请登记失败",
  });
}

export async function completeAnonymization(fetcher: Fetcher = fetch, input: { userId: string; requestId: string; reason: string; password: string }) {
  return write<{ targetUserId: string; privacyRequestId: string; status: "COMPLETED"; auditId: string }>(fetcher, {
    path: `/api/v1/admin/users/${encodeURIComponent(input.userId)}/anonymization-requests/${encodeURIComponent(input.requestId)}/complete`, method: "POST",
    body: { reason: input.reason.trim() }, reason: input.reason, password: input.password, failure: "匿名化处置失败",
  });
}

async function read<T>(fetcher: Fetcher, path: string, failure: string): Promise<T> {
  const response = await fetcher(path, { credentials: "same-origin", cache: "no-store" });
  const result = await response.json().catch(() => ({})) as Failure & { data?: T };
  if (!response.ok || result.data === undefined) throw new Error(result.error?.message || failure);
  return result.data;
}

/**
 * Every lifecycle write follows the same shape: check the justification locally,
 * confirm the operator's own password, then send the change. The re-auth proof is
 * scoped to /api/v1/admin and lasts five minutes; the server refuses the write
 * without it, so this pairing is a requirement rather than a convenience.
 */
async function write<T>(fetcher: Fetcher, input: { path: string; method: string; body: Record<string, unknown>; reason: string; password: string; failure: string }): Promise<T> {
  const reason = input.reason.trim();
  if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) {
    throw new Error(`请填写 ${MIN_REASON_LENGTH}-${MAX_REASON_LENGTH} 字的操作理由`);
  }
  const reauth = await fetcher("/api/v1/auth/reauthenticate", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: input.password }) });
  const reauthBody = await reauth.json().catch(() => ({})) as Failure;
  if (!reauth.ok) throw new Error(reauthBody.error?.message || "管理员身份确认失败");

  const response = await fetcher(input.path, { method: input.method, credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(input.body) });
  const result = await response.json().catch(() => ({})) as Failure & { data?: T };
  if (!response.ok || result.data === undefined) throw new Error(result.error?.message || input.failure);
  return result.data;
}

function reviveUser(raw: unknown): ManagedUser {
  const row = raw as Record<string, unknown>;
  return {
    id: String(row.id), username: String(row.username), nickname: (row.nickname as string | null) ?? null,
    status: row.status as AccountStatus, lastSeenAt: row.lastSeenAt ? new Date(String(row.lastSeenAt)) : null,
    activityBucket: row.activityBucket as ActivityBucket,
    activeSessionCount: Number(row.activeSessionCount ?? 0), roomCount: Number(row.roomCount ?? 0),
    ownedRoomCount: Number(row.ownedRoomCount ?? 0), restrictedRoomCount: Number(row.restrictedRoomCount ?? 0),
    openReportCount: Number(row.openReportCount ?? 0), communityRestricted: Boolean(row.communityRestricted),
  };
}

function reviveLifecycle(raw: Record<string, unknown> | null): AnonymizationSummary | null {
  if (!raw || raw.status === undefined || raw.dueAt === undefined) return null;
  return { status: raw.status as AnonymizationSummary["status"], dueAt: new Date(String(raw.dueAt)), overdue: Boolean(raw.overdue), daysRemaining: Number(raw.daysRemaining ?? 0) };
}
