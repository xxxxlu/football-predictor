import { describe, expect, it } from "vitest";
import { anonymousDisplayName, roomAllowsMemberRead, roomAllowsPredictions, roomTransition } from "./moderation-privacy.js";

describe("moderation and privacy rules", () => {
  it("blocks predictions as soon as a room is restricted or closed", () => {
    expect(roomAllowsPredictions("ACTIVE")).toBe(true);
    expect(roomAllowsPredictions("RESTRICTED")).toBe(false);
    expect(roomAllowsPredictions("CLOSED")).toBe(false);
  });

  it("keeps restricted and closed rooms readable to existing members for traceability", () => {
    expect(roomAllowsMemberRead("ACTIVE")).toBe(true);
    expect(roomAllowsMemberRead("RESTRICTED")).toBe(true);
    expect(roomAllowsMemberRead("CLOSED")).toBe(true);
  });

  it("maps admin actions to explicit room states and creates a non-identifying label", () => {
    expect(roomTransition("RESTRICT")).toBe("RESTRICTED");
    expect(roomTransition("CLOSE")).toBe("CLOSED");
    expect(roomTransition("RESTORE")).toBe("ACTIVE");
    expect(anonymousDisplayName("12345678-abcd-0000-0000-000000000000")).toBe("已删除用户-12345678");
  });
});
