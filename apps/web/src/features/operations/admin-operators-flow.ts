export type OperatorRole = "SUPER_ADMIN" | "OPERATIONS_ADMIN" | "COMMUNITY_MODERATOR";
export type GrantableOperatorRole = Exclude<OperatorRole, "SUPER_ADMIN">;
export type OperatorEntry = { id: string; username: string; status: "ACTIVE" | "DISABLED"; isSuperAdmin: boolean; roles: GrantableOperatorRole[] };
export type OperatorRoster = { actorId: string; operators: OperatorEntry[] };

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Failure = { error?: { message?: string } };

export const GRANTABLE_ROLES: GrantableOperatorRole[] = ["OPERATIONS_ADMIN", "COMMUNITY_MODERATOR"];
export const ROLE_LABELS: Record<OperatorRole, string> = {
  SUPER_ADMIN: "超级管理员",
  OPERATIONS_ADMIN: "运营管理员",
  COMMUNITY_MODERATOR: "社区协管员",
};
export const ROLE_SCOPES: Record<GrantableOperatorRole, string> = {
  OPERATIONS_ADMIN: "用户安全、房间状态与运营任务",
  COMMUNITY_MODERATOR: "举报、聊天与禁言治理",
};

export async function loadOperatorRoster(fetcher: Fetcher = fetch): Promise<OperatorRoster> {
  const response = await fetcher("/api/v1/admin/operators", { credentials: "same-origin", cache: "no-store" });
  const result = await response.json().catch(() => ({})) as Failure & { data?: OperatorRoster };
  if (!response.ok || !result.data) throw new Error(result.error?.message || "无法加载运营人员列表");
  return result.data;
}

/**
 * Confirms the operator's identity, then grants or revokes one duty. The proof
 * cookie is scoped to /api/v1/admin and lasts five minutes; the server rejects
 * the change without it, so this pairing is not an optimisation.
 */
export async function setOperatorRole(fetcher: Fetcher = fetch, input: { userId: string; role: GrantableOperatorRole; granted: boolean; password: string }) {
  const reauth = await fetcher("/api/v1/auth/reauthenticate", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: input.password }) });
  const reauthBody = await reauth.json().catch(() => ({})) as Failure;
  if (!reauth.ok) throw new Error(reauthBody.error?.message || "管理员身份确认失败");

  const path = `/api/v1/admin/operators/${encodeURIComponent(input.userId)}/roles/${encodeURIComponent(input.role)}`;
  const response = await fetcher(path, { method: input.granted ? "PUT" : "DELETE", credentials: "same-origin", headers: { "content-type": "application/json" } });
  const result = await response.json().catch(() => ({})) as Failure & { data?: { targetUserId: string; role: GrantableOperatorRole; granted: boolean; changed: boolean; auditId?: string } };
  if (!response.ok || !result.data) throw new Error(result.error?.message || "职责变更失败");
  return result.data;
}
