type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function logoutForcedPasswordSession(fetcher: Fetcher = fetch) {
  const response = await fetcher("/api/v1/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  const result = await response.json().catch(() => ({})) as { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message || "无法退出当前账户。");
  return { redirectTo: "/login" as const };
}
