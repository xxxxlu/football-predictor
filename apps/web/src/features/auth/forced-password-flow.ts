import { purgePrivateCaches } from "../pwa/private-cache";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function logoutForcedPasswordSession(fetcher: Fetcher = fetch) {
  const response = await fetcher("/api/v1/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  const result = await response.json().catch(() => ({})) as { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message || "无法退出当前账户。");
  // 7.3a：登出后设备上不留任何私有只读缓存。
  await purgePrivateCaches().catch(() => {});
  return { redirectTo: "/login" as const };
}
