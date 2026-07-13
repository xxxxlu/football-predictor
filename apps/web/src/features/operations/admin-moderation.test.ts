import { describe, expect, it } from "vitest";
import { moderationActionRequest, moderationReauthRequest } from "./admin-moderation.js";

describe("admin moderation re-auth flow", () => {
  it("reauthenticates with the current password before sending the room action", () => {
    expect(moderationReauthRequest("current-password-123")).toEqual({
      url: "/api/v1/auth/reauthenticate",
      init: { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "current-password-123" }) },
    });
    expect(moderationActionRequest("room/1", "CLOSE", "多次违规举报")).toMatchObject({
      url: "/api/v1/admin/rooms/room%2F1",
      init: { method: "PATCH", credentials: "same-origin" },
    });
  });
});
