import { describe, expect, it } from "vitest";
import { loginHref, recoveryReceiptContinueHref, safeReturnTo } from "./navigation.js";

describe("auth navigation", () => {
  it("keeps an internal return target including its query", () => {
    expect(safeReturnTo("/rooms/room-1?tab=ledger")).toBe("/rooms/room-1?tab=ledger");
    expect(loginHref("/rooms/room-1?tab=ledger")).toBe("/login?returnTo=%2Frooms%2Froom-1%3Ftab%3Dledger");
  });

  it.each(["https://evil.example/steal", "//evil.example/steal", "/\\evil.example/steal", "/%5cevil.example/steal", "/%2f%2fevil.example/steal", "javascript:alert(1)", "rooms"])(
    "rejects the unsafe return target %s",
    (target) => expect(safeReturnTo(target)).toBe("/rooms"),
  );

  it("builds the post-registration login target without allowing an open redirect", () => {
    expect(loginHref("https://evil.example/steal")).toBe("/login?returnTo=%2Frooms");
    expect(recoveryReceiptContinueHref("/rooms/room-1")).toBe("/login?returnTo=%2Frooms%2Froom-1");
  });
});
