export type SessionUser = { id: string; username: string; status: string; isSuperAdmin?: boolean; mustChangePassword?: boolean };
export type SessionState =
  | { kind: "authenticated"; user: SessionUser }
  | { kind: "anonymous" }
  | { kind: "unavailable" };

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function loadSession(fetcher: Fetcher = fetch): Promise<SessionState> {
  try {
    const response = await fetcher("/api/v1/auth/session", { cache: "no-store", credentials: "same-origin" });
    if (response.status === 401) return { kind: "anonymous" };
    if (!response.ok) return { kind: "unavailable" };
    const result = await response.json() as { data?: { user?: SessionUser } };
    return result.data?.user ? { kind: "authenticated", user: result.data.user } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
