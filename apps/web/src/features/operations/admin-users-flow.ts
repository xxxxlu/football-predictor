export type ManagedUser = { id: string; username: string; status: "ACTIVE" | "DISABLED" };
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Failure = { error?: { message?: string } };

export async function loadAdminUsers(fetcher: Fetcher = fetch): Promise<ManagedUser[]> {
  const response = await fetcher("/api/v1/admin/users", { credentials: "same-origin", cache: "no-store" });
  const result = await response.json().catch(() => ({})) as Failure & { data?: { users?: ManagedUser[] } };
  if (!response.ok) throw new Error(result.error?.message || "无法加载用户列表");
  return result.data?.users ?? [];
}

export async function updateAdminUserStatus(fetcher: Fetcher = fetch, input: { userId: string; status: ManagedUser["status"]; password: string }) {
  const reauth = await fetcher("/api/v1/auth/reauthenticate", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: input.password }) });
  const reauthBody = await reauth.json().catch(() => ({})) as Failure;
  if (!reauth.ok) throw new Error(reauthBody.error?.message || "管理员身份确认失败");
  const response = await fetcher(`/api/v1/admin/users/${encodeURIComponent(input.userId)}/status`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: input.status }) });
  const result = await response.json().catch(() => ({})) as Failure & { data?: { targetUserId: string; status: ManagedUser["status"]; auditId: string } };
  if (!response.ok || !result.data) throw new Error(result.error?.message || "账户状态更新失败");
  return result.data;
}
