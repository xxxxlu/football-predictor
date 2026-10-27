export type SessionUser = { id: string; username: string; status: string; isSuperAdmin?: boolean; mustChangePassword?: boolean };
export type SessionState =
  | { kind: "authenticated"; user: SessionUser }
  | { kind: "anonymous" }
  | { kind: "unavailable" };

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let inMemorySession: SessionState | undefined;

export function getCachedSession(): SessionState | undefined {
  return typeof window !== "undefined" ? inMemorySession : undefined;
}

export function setCachedSession(session: SessionState | undefined): void {
  inMemorySession = session;
}

export async function loadSession(fetcher: Fetcher = fetch): Promise<SessionState> {
  try {
    const response = await fetcher("/api/v1/auth/session", { cache: "no-store", credentials: "same-origin" });
    if (response.status === 401) {
      if (typeof window !== "undefined") inMemorySession = { kind: "anonymous" };
      return { kind: "anonymous" };
    }
    if (!response.ok) return { kind: "unavailable" };
    const result = await response.json() as { data?: { user?: SessionUser } };
    const state: SessionState = result.data?.user ? { kind: "authenticated", user: result.data.user } : { kind: "unavailable" };
    if (typeof window !== "undefined") inMemorySession = state;
    return state;
  } catch {
    return { kind: "unavailable" };
  }
}
