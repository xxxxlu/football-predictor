import { describe, expect, it, vi } from "vitest";
import { loadSession } from "./session-client.js";

describe("loadSession", () => {
  it("returns the authenticated user from the same-origin session endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { user: { id: "user-1", username: "alice", status: "ACTIVE" } } }));

    await expect(loadSession(fetcher)).resolves.toEqual({ kind: "authenticated", user: { id: "user-1", username: "alice", status: "ACTIVE" } });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/auth/session", { cache: "no-store", credentials: "same-origin" });
  });

  it("treats a 401 as an anonymous session", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 }));
    await expect(loadSession(fetcher)).resolves.toEqual({ kind: "anonymous" });
  });

  it("keeps transient failures distinct from an anonymous session", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code: "INTERNAL_ERROR" } }, { status: 500 }));
    await expect(loadSession(fetcher)).resolves.toEqual({ kind: "unavailable" });
  });
});
