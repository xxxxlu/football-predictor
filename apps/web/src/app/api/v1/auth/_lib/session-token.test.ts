import { describe, expect, it } from "vitest";
import { readCookie, readReauthProof, readSessionToken } from "./session-token.js";

describe("session cookie readers", () => {
  it("reads and decodes a named cookie", () => {
    expect(readCookie("other=1; fp_session=hello%20world", "fp_session")).toBe("hello world");
  });

  it("returns null when the requested cookie is missing", () => {
    expect(readSessionToken(new Request("https://pulse.test"))).toBeNull();
  });

  it("keeps session and reauthentication cookies separate", () => {
    const request = new Request("https://pulse.test", {
      headers: { cookie: "fp_session=session-token; fp_reauth=proof-token" },
    });
    expect(readSessionToken(request)).toBe("session-token");
    expect(readReauthProof(request)).toBe("proof-token");
  });
});
