import { describe, expect, it, vi } from "vitest";
import { logoutForcedPasswordSession } from "./forced-password-flow.js";

describe("forced password flow", () => {
  it("allows a user trapped behind mandatory rotation to revoke the session", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { loggedOut: true } }), { status: 200 }));

    await expect(logoutForcedPasswordSession(fetcher)).resolves.toEqual({ redirectTo: "/login" });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  });

  it("keeps the user on the page when logout fails", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "logout unavailable" } }), { status: 503 }));
    await expect(logoutForcedPasswordSession(fetcher)).rejects.toThrow("logout unavailable");
  });
});
